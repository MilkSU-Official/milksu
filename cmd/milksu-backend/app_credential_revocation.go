package main

import (
	"fmt"
	"log"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// credentialWithdrawn reports whether a settings save took a Provider credential away
// instead of replacing one: a stored key is gone, the service holding it was switched
// off, or its row was deleted entirely.
//
// Replacing a key is lazy on purpose - the new value takes over on the next turn, and a
// turn that is already streaming finishes on the environment it started with. Taking a
// key away is the opposite change. Credentials reach a Sidecar through its process
// environment at spawn time, so a child started earlier keeps the withdrawn key usable
// until that process ends; only stopping it puts the credential out of reach.
//
// The question is asked about the credentials a child can actually be holding, which is
// what engineEnvironment injects: an enabled service with a stored key, and the account
// relay when it is on. A key a disabled service was keeping never reached a child, so
// deleting it takes nothing back and must not cut somebody's turn.
//
// It reads nothing but the HasAPIKey / HasKey / Enabled projections, so no credential
// value is compared, logged or copied here.
func credentialWithdrawn(previous, next config.AppSettings) bool {
	for name, before := range previous.Providers {
		if !before.Enabled || !before.HasAPIKey {
			continue
		}
		after, kept := next.Providers[name]
		if !kept || !after.Enabled || !after.HasAPIKey {
			return true
		}
	}
	before := previous.Relay
	if before == nil || !before.Enabled || !before.HasKey {
		return false
	}
	after := next.Relay
	return after == nil || !after.Enabled || !after.HasKey
}

// stopSidecarsHoldingWithdrawnCredential ends every Sidecar still marked stale, mid-turn
// or not. A turn running on a credential the user just took away would fail on its next
// model call anyway, and leaving it alive is exactly what the user undid.
func (a *App) stopSidecarsHoldingWithdrawnCredential(reason string) {
	if a.engines == nil {
		return
	}
	stopped := a.engines.StopStaleSidecars()
	if stopped == 0 {
		return
	}
	detail := fmt.Sprintf("%d sidecar(s) stopped after a credential was withdrawn (%s)", stopped, reason)
	log.Printf("[credentials] %s", detail)
	if a.diagnostics != nil {
		a.diagnostics.Record("coding-engine", "info", detail)
	}
}
