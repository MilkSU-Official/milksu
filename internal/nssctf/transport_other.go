//go:build !darwin

package nssctf

import "net/http"

func defaultTransport() http.RoundTripper {
	return http.DefaultTransport.(*http.Transport).Clone()
}
