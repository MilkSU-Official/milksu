#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <node_api.h>
#include <stdlib.h>

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  bool result;
} screen_permission_request;

static napi_value boolean_result(napi_env env, bool value) {
  napi_value result;
  if (napi_get_boolean(env, value, &result) != napi_ok) return NULL;
  return result;
}

static napi_value preflight(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean_result(env, CGPreflightScreenCaptureAccess());
}

static void execute_request(napi_env env, void *data) {
  (void)env;
  screen_permission_request *request = data;
  @autoreleasepool {
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    [SCShareableContent
      getShareableContentExcludingDesktopWindows:YES
      onScreenWindowsOnly:YES
      completionHandler:^(SCShareableContent *content, NSError *error) {
        request->result = content != nil && error == nil;
        dispatch_semaphore_signal(finished);
      }];
    dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 90 * NSEC_PER_SEC);
    if (dispatch_semaphore_wait(finished, timeout) != 0) request->result = false;
  }
}

static void complete_request(napi_env env, napi_status status, void *data) {
  screen_permission_request *request = data;
  if (status == napi_ok) {
    napi_value result = boolean_result(env, request->result);
    if (result != NULL) napi_resolve_deferred(env, request->deferred, result);
  } else {
    napi_value message;
    napi_value error;
    napi_create_string_utf8(
      env,
      "macOS screen permission request failed",
      NAPI_AUTO_LENGTH,
      &message
    );
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, request->deferred, error);
  }
  napi_delete_async_work(env, request->work);
  free(request);
}

static napi_value request_permission(napi_env env, napi_callback_info info) {
  (void)info;
  screen_permission_request *request = calloc(1, sizeof(*request));
  if (request == NULL) {
    napi_throw_error(env, NULL, "could not allocate macOS screen permission request");
    return NULL;
  }

  napi_value promise;
  napi_value resource_name;
  if (
    napi_create_promise(env, &request->deferred, &promise) != napi_ok ||
    napi_create_string_utf8(
      env,
      "MilkSU ScreenCaptureKit permission",
      NAPI_AUTO_LENGTH,
      &resource_name
    ) != napi_ok ||
    napi_create_async_work(
      env,
      NULL,
      resource_name,
      execute_request,
      complete_request,
      request,
      &request->work
    ) != napi_ok ||
    napi_queue_async_work(env, request->work) != napi_ok
  ) {
    if (request->work != NULL) napi_delete_async_work(env, request->work);
    free(request);
    napi_throw_error(env, NULL, "could not start macOS screen permission request");
    return NULL;
  }
  return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "preflight", NULL, preflight, NULL, NULL, NULL, napi_default, NULL },
    { "request", NULL, request_permission, NULL, NULL, NULL, napi_default, NULL },
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
