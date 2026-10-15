#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <stdlib.h>

static const CGFloat milksu_minimum_target_window_width = 120.0;
static const CGFloat milksu_minimum_target_window_height = 80.0;

static NSString *milksu_synthetic_bundle_id(NSString *name) {
  NSMutableString *out = [NSMutableString string];
  for (NSUInteger i = 0; i < [name length]; i++) {
    unichar c = [name characterAtIndex:i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-') {
      [out appendFormat:@"%C", c];
    } else if ([out length] > 0 && ![[out substringFromIndex:[out length] - 1] isEqualToString:@"."]) {
      [out appendString:@"."];
    }
  }
  while ([out hasPrefix:@"."]) {
    [out deleteCharactersInRange:NSMakeRange(0, 1)];
  }
  while ([out hasSuffix:@"."]) {
    [out deleteCharactersInRange:NSMakeRange([out length] - 1, 1)];
  }
  if ([out length] == 0) {
    return @"app.unsigned";
  }
  return out;
}

static napi_status set_utf8_property(napi_env env, napi_value object, const char *name, NSString *value) {
  if (value == nil) return napi_ok;
  const char *utf8 = [value UTF8String];
  napi_value js;
  if (napi_create_string_utf8(env, utf8 ? utf8 : "", NAPI_AUTO_LENGTH, &js) != napi_ok) {
    return napi_generic_failure;
  }
  return napi_set_named_property(env, object, name, js);
}

static napi_value empty_array(napi_env env) {
  napi_value result;
  if (napi_create_array_with_length(env, 0, &result) != napi_ok) return NULL;
  return result;
}

static napi_value list_windows(napi_env env, napi_callback_info info) {
  (void)info;
  @autoreleasepool {
    CFArrayRef windowList = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID
    );
    if (windowList == NULL) return empty_array(env);

    napi_value targets;
    if (napi_create_array(env, &targets) != napi_ok) {
      CFRelease(windowList);
      return empty_array(env);
    }

    uint32_t count = 0;
    for (NSDictionary *window in (__bridge NSArray *)windowList) {
      NSNumber *layer = window[(id)kCGWindowLayer];
      if (layer == nil || [layer intValue] != 0) continue;
      NSNumber *pid = window[(id)kCGWindowOwnerPID];
      NSNumber *windowID = window[(id)kCGWindowNumber];
      NSString *owner = window[(id)kCGWindowOwnerName];
      NSDictionary *bounds = window[(id)kCGWindowBounds];
      CGRect rect = CGRectZero;
      if (pid == nil || windowID == nil || [pid intValue] <= 1 || [windowID longLongValue] <= 0) {
        continue;
      }
      if (bounds == nil || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &rect)) {
        continue;
      }
      if (rect.size.width < milksu_minimum_target_window_width || rect.size.height < milksu_minimum_target_window_height) {
        continue;
      }
      NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:[pid intValue]];
      NSString *bundleID = app.bundleIdentifier;
      if (bundleID == nil || [bundleID length] == 0) {
        bundleID = milksu_synthetic_bundle_id(app.localizedName ?: owner ?: @"app.unsigned");
      }
      NSString *title = window[(id)kCGWindowName];
      napi_value entry;
      napi_value pid_value;
      napi_value window_id_value;
      if (
        napi_create_object(env, &entry) != napi_ok ||
        napi_create_int32(env, [pid intValue], &pid_value) != napi_ok ||
        napi_create_int64(env, [windowID longLongValue], &window_id_value) != napi_ok ||
        napi_set_named_property(env, entry, "pid", pid_value) != napi_ok ||
        napi_set_named_property(env, entry, "windowId", window_id_value) != napi_ok ||
        set_utf8_property(env, entry, "name", app.localizedName ?: owner ?: bundleID) != napi_ok ||
        set_utf8_property(env, entry, "bundleId", bundleID) != napi_ok
      ) {
        continue;
      }
      if (title != nil && [title length] > 0) {
        set_utf8_property(env, entry, "windowTitle", title);
      }
      if (napi_set_element(env, targets, count, entry) == napi_ok) count += 1;
    }
    CFRelease(windowList);
    return targets;
  }
}

static napi_value host_executable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_value result;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_create_string_utf8(env, "", NAPI_AUTO_LENGTH, &result);
    return result;
  }
  int32_t pid = 0;
  if (napi_get_value_int32(env, argv[0], &pid) != napi_ok || pid <= 1) {
    napi_create_string_utf8(env, "", NAPI_AUTO_LENGTH, &result);
    return result;
  }
  @autoreleasepool {
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    NSString *path = app.executableURL.path;
    if (path == nil || [path length] == 0) {
      napi_create_string_utf8(env, "", NAPI_AUTO_LENGTH, &result);
      return result;
    }
    const char *utf8 = [path UTF8String];
    napi_create_string_utf8(env, utf8 ? utf8 : "", NAPI_AUTO_LENGTH, &result);
    return result;
  }
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "listWindows", NULL, list_windows, NULL, NULL, NULL, napi_default, NULL },
    { "hostExecutable", NULL, host_executable, NULL, NULL, NULL, napi_default, NULL },
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
