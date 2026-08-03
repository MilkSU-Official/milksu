//go:build darwin && cgo

package computercap

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework CoreGraphics -framework Foundation
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <stdlib.h>

char* milksu_computer_use_targets_json(void) {
	@autoreleasepool {
		CFArrayRef windowList = CGWindowListCopyWindowInfo(
			kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
			kCGNullWindowID
		);
		if (windowList == NULL) {
			return strdup("[]");
		}
		NSMutableArray *targets = [NSMutableArray array];
		for (NSDictionary *window in (__bridge NSArray *)windowList) {
			NSNumber *layer = window[(id)kCGWindowLayer];
			if (layer == nil || [layer intValue] != 0) {
				continue;
			}
			NSNumber *pid = window[(id)kCGWindowOwnerPID];
			NSNumber *windowID = window[(id)kCGWindowNumber];
			NSString *owner = window[(id)kCGWindowOwnerName];
			if (pid == nil || windowID == nil || [pid intValue] <= 1 || [windowID longLongValue] <= 0) {
				continue;
			}
			NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:[pid intValue]];
			NSString *bundleID = app.bundleIdentifier;
			if (bundleID == nil || [bundleID length] == 0) {
				continue;
			}
			NSString *title = window[(id)kCGWindowName];
			NSMutableDictionary *entry = [NSMutableDictionary dictionary];
			entry[@"pid"] = pid;
			entry[@"windowId"] = windowID;
			entry[@"name"] = app.localizedName ?: owner ?: bundleID;
			entry[@"bundleId"] = bundleID;
			if (title != nil && [title length] > 0) {
				entry[@"windowTitle"] = title;
			}
			[targets addObject:entry];
		}
		CFRelease(windowList);
		NSData *data = [NSJSONSerialization dataWithJSONObject:targets options:0 error:nil];
		if (data == nil) {
			return strdup("[]");
		}
		NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
		return strdup([json UTF8String]);
	}
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"
)

func platformTargets() ([]Target, error) {
	raw := C.milksu_computer_use_targets_json()
	if raw == nil {
		return nil, fmt.Errorf("macOS returned no Computer Use target list")
	}
	defer C.free(unsafe.Pointer(raw))
	var targets []Target
	if err := json.Unmarshal([]byte(C.GoString(raw)), &targets); err != nil {
		return nil, fmt.Errorf("decode Computer Use target list: %w", err)
	}
	return targets, nil
}
