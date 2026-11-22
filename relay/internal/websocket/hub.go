package websocket

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type Client struct {
	conn net.Conn
	hub  *Hub
	send chan []byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
}

func NewHub() *Hub {
	h := &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 128),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) BroadcastEvent(eventType string, data interface{}) {
	payload, err := json.Marshal(map[string]interface{}{
		"type": eventType,
		"data": data,
	})
	if err == nil {
		h.broadcast <- payload
	}
}

// ServeWS upgrades the HTTP connection to WebSocket (Pure Go RFC 6455 Handshake)
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "Expected WebSocket Upgrade", http.StatusBadRequest)
		return
	}

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		http.Error(w, "Missing Sec-WebSocket-Key", http.StatusBadRequest)
		return
	}

	// Compute handshake accept key
	hsh := sha1.New()
	hsh.Write([]byte(key + wsGUID))
	acceptKey := base64.StdEncoding.EncodeToString(hsh.Sum(nil))

	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Webserver doesn't support hijacking", http.StatusInternalServerError)
		return
	}

	conn, bufrw, err := hj.Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Send handshake HTTP response
	response := fmt.Sprintf("HTTP/1.1 101 Switching Protocols\r\n"+
		"Upgrade: websocket\r\n"+
		"Connection: Upgrade\r\n"+
		"Sec-WebSocket-Accept: %s\r\n\r\n", acceptKey)

	if _, err := bufrw.WriteString(response); err != nil {
		conn.Close()
		return
	}
	_ = bufrw.Flush()

	client := &Client{
		conn: conn,
		hub:  h,
		send: make(chan []byte, 32),
	}

	h.register <- client

	go client.writePump()
	go client.readPump(bufrw.Reader)
}

func (c *Client) readPump(r *bufio.Reader) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		header := make([]byte, 2)
		if _, err := io.ReadFull(r, header); err != nil {
			break
		}

		opcode := header[0] & 0x0F
		if opcode == 8 { // Close frame
			break
		}

		isMasked := (header[1] & 0x80) != 0
		var payloadLen int64 = int64(header[1] & 0x7F)

		if payloadLen == 126 {
			ext := make([]byte, 2)
			if _, err := io.ReadFull(r, ext); err != nil {
				break
			}
			payloadLen = int64(binary.BigEndian.Uint16(ext))
		} else if payloadLen == 127 {
			ext := make([]byte, 8)
			if _, err := io.ReadFull(r, ext); err != nil {
				break
			}
			payloadLen = int64(binary.BigEndian.Uint64(ext))
		}

		var maskKey []byte
		if isMasked {
			maskKey = make([]byte, 4)
			if _, err := io.ReadFull(r, maskKey); err != nil {
				break
			}
		}

		payload := make([]byte, payloadLen)
		if _, err := io.ReadFull(r, payload); err != nil {
			break
		}

		if isMasked {
			for i := int64(0); i < payloadLen; i++ {
				payload[i] ^= maskKey[i%4]
			}
		}

		// Handle client ping
		if opcode == 9 {
			// Pong
			c.sendFrame(10, payload)
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()

	for msg := range c.send {
		if err := c.sendFrame(1, msg); err != nil {
			log.Printf("[WebSocket] Write error: %v", err)
			break
		}
	}
}

func (c *Client) sendFrame(opcode byte, payload []byte) error {
	var frame []byte
	frame = append(frame, 0x80|opcode) // FIN + Opcode

	length := len(payload)
	if length < 126 {
		frame = append(frame, byte(length))
	} else if length <= 65535 {
		frame = append(frame, 126)
		ext := make([]byte, 2)
		binary.BigEndian.PutUint16(ext, uint16(length))
		frame = append(frame, ext...)
	} else {
		frame = append(frame, 127)
		ext := make([]byte, 8)
		binary.BigEndian.PutUint64(ext, uint64(length))
		frame = append(frame, ext...)
	}

	frame = append(frame, payload...)
	_, err := c.conn.Write(frame)
	return err
}
