//go:build darwin && cgo

package computercap

/*
#cgo LDFLAGS: -framework ApplicationServices -framework CoreGraphics -framework CoreFoundation
#include <ApplicationServices/ApplicationServices.h>
#include <CoreGraphics/CoreGraphics.h>

static bool milksu_ax_trusted(bool prompt) {
	const void *keys[] = { kAXTrustedCheckOptionPrompt };
	const void *values[] = { prompt ? kCFBooleanTrue : kCFBooleanFalse };
	CFDictionaryRef options = CFDictionaryCreate(
		kCFAllocatorDefault,
		keys,
		values,
		1,
		&kCFTypeDictionaryKeyCallBacks,
		&kCFTypeDictionaryValueCallBacks
	);
	bool trusted = AXIsProcessTrustedWithOptions(options);
	CFRelease(options);
	return trusted;
}

static bool milksu_screen_recording(bool prompt) {
	if (__builtin_available(macOS 10.15, *)) {
		if (CGPreflightScreenCaptureAccess()) {
			return true;
		}
		if (!prompt) {
			return false;
		}
		return CGRequestScreenCaptureAccess();
	}
	return false;
}
*/
import "C"

func platformPermissions(prompt bool) Permissions {
	return Permissions{
		Accessibility:   bool(C.milksu_ax_trusted(C.bool(prompt))),
		ScreenRecording: bool(C.milksu_screen_recording(C.bool(prompt))),
	}
}
