package nssctf

import (
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
)

var systemProxyValuePattern = regexp.MustCompile(`(?m)^\s*([A-Z]+(?:Enable|Proxy|Port))\s*:\s*(.+?)\s*$`)

func defaultTransport() http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(request *http.Request) (*url.URL, error) {
		proxyURL, err := http.ProxyFromEnvironment(request)
		if proxyURL != nil || err != nil {
			return proxyURL, err
		}
		return darwinSystemProxy(request.URL.Scheme)
	}
	return transport
}

func darwinSystemProxy(scheme string) (*url.URL, error) {
	output, err := exec.Command("/usr/sbin/scutil", "--proxy").Output()
	if err != nil {
		return nil, nil
	}

	values := make(map[string]string)
	for _, match := range systemProxyValuePattern.FindAllStringSubmatch(string(output), -1) {
		values[match[1]] = match[2]
	}

	prefix := "HTTP"
	if scheme == "https" {
		prefix = "HTTPS"
	}
	if values[prefix+"Enable"] != "1" || values[prefix+"Proxy"] == "" {
		return nil, nil
	}
	port, err := strconv.Atoi(values[prefix+"Port"])
	if err != nil || port <= 0 || port > 65535 {
		return nil, nil
	}
	return url.Parse("http://" + values[prefix+"Proxy"] + ":" + strconv.Itoa(port))
}
