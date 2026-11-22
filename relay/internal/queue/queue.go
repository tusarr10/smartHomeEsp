package queue

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Event struct {
	EventID   string                 `json:"eventId"`
	Type      string                 `json:"type"` // "RELAY_TRANSITION", "BREAKER_TRIP", "NODE_OFFLINE"
	NodeID    string                 `json:"nodeId"`
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
	Synced    bool                   `json:"synced"`
}

type EventSpool struct {
	mu       sync.Mutex
	filePath string
	maxMB    int
}

func NewEventSpool(dataDir string, maxMB int) (*EventSpool, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create queue dir: %w", err)
	}
	fPath := filepath.Join(dataDir, "events.jsonl")
	return &EventSpool{
		filePath: fPath,
		maxMB:    maxMB,
	}, nil
}

func (q *EventSpool) Push(evtType string, nodeID string, data map[string]interface{}) (*Event, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	evt := &Event{
		EventID:   fmt.Sprintf("evt-%d", time.Now().UnixNano()),
		Type:      evtType,
		NodeID:    nodeID,
		Timestamp: time.Now().Unix(),
		Data:      data,
		Synced:    false,
	}

	bytes, err := json.Marshal(evt)
	if err != nil {
		return nil, err
	}

	// Check file size limit
	fi, err := os.Stat(q.filePath)
	if err == nil && fi.Size() > int64(q.maxMB*1024*1024) {
		// Rotate file if exceeding limit
		oldPath := q.filePath + ".old"
		_ = os.Rename(q.filePath, oldPath)
	}

	f, err := os.OpenFile(q.filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("open spool file: %w", err)
	}
	defer f.Close()

	if _, err := f.Write(append(bytes, '\n')); err != nil {
		return nil, fmt.Errorf("write spool file: %w", err)
	}

	return evt, nil
}

func (q *EventSpool) ReadRecent(limit int) ([]*Event, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	f, err := os.Open(q.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []*Event{}, nil
		}
		return nil, err
	}
	defer f.Close()

	var events []*Event
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var evt Event
		if err := json.Unmarshal(line, &evt); err == nil {
			events = append(events, &evt)
		}
	}

	// Return last 'limit' items
	if limit > 0 && len(events) > limit {
		events = events[len(events)-limit:]
	}

	return events, nil
}
