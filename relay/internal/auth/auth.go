package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"smarthome-edge/internal/config"
)

type TokenClaims struct {
	Issuer      string   `json:"iss,omitempty"`
	Subject     string   `json:"sub"`
	HomeID      string   `json:"home_id,omitempty"`
	NodeIDs     []string `json:"node_ids"`
	Permissions []string `json:"permissions"`
	Exp         int64    `json:"exp"`
}

type Authenticator struct {
	cfg *config.SecurityConfig
}

func NewAuthenticator(cfg *config.SecurityConfig) *Authenticator {
	return &Authenticator{cfg: cfg}
}

// ValidateToken parses and validates a Bearer token
func (a *Authenticator) ValidateToken(tokenStr string) (*TokenClaims, error) {
	// If security is disabled for dev/testing, grant full wildcard access
	if !a.cfg.RequireMobileToken {
		return &TokenClaims{
			Subject:     "dev-user",
			Permissions: []string{"devices:view", "devices:control"},
			NodeIDs:     []string{"*"}, // wildcard
			Exp:         time.Now().Unix() + 86400,
		}, nil
	}

	tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
	tokenStr = strings.TrimSpace(tokenStr)
	if tokenStr == "" {
		return nil, fmt.Errorf("empty token")
	}

	// Simple HMAC-SHA256 signed token check (or standard JWT format header.payload.signature)
	parts := strings.Split(tokenStr, ".")
	if len(parts) == 3 {
		payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, fmt.Errorf("invalid token payload encoding: %w", err)
		}

		// Verify signature if secret provided
		if a.cfg.SharedSecret != "" {
			sigExpected := a.sign(parts[0] + "." + parts[1])
			if !hmac.Equal([]byte(sigExpected), []byte(parts[2])) {
				return nil, fmt.Errorf("invalid token signature")
			}
		}

		var claims TokenClaims
		if err := json.Unmarshal(payloadBytes, &claims); err != nil {
			return nil, fmt.Errorf("parse claims: %w", err)
		}

		if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
			return nil, fmt.Errorf("token expired")
		}

		return &claims, nil
	}

	return nil, fmt.Errorf("malformed token structure")
}

func (a *Authenticator) CanAccessNode(claims *TokenClaims, targetNodeID string) bool {
	if claims == nil {
		return false
	}
	for _, n := range claims.NodeIDs {
		if n == "*" || n == targetNodeID {
			return true
		}
	}
	return false
}

func (a *Authenticator) sign(message string) string {
	mac := hmac.New(sha256.New, []byte(a.cfg.SharedSecret))
	mac.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// GenerateTestToken creates a signed test token for mobile app testing
func (a *Authenticator) GenerateTestToken(sub string, nodes []string, expHours int) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims := TokenClaims{
		Issuer:      "smarthome-edge",
		Subject:     sub,
		NodeIDs:     nodes,
		Permissions: []string{"devices:view", "devices:control"},
		Exp:         time.Now().Add(time.Duration(expHours) * time.Hour).Unix(),
	}
	claimBytes, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(claimBytes)
	sig := a.sign(header + "." + payload)
	return header + "." + payload + "." + sig, nil
}
