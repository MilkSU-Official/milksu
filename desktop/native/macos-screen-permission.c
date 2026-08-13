#include <CoreGraphics/CoreGraphics.h>
#include <node_api.h>

static napi_value boolean_result(napi_env env, bool value) {
  napi_value result;
  if (napi_get_boolean(env, value, &result) != napi_ok) return NULL;
  return result;
}

static napi_value preflight(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean_result(env, CGPreflightScreenCaptureAccess());
}

static napi_value request(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean_result(env, CGRequestScreenCaptureAccess());
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "preflight", NULL, preflight, NULL, NULL, NULL, napi_default, NULL },
    { "request", NULL, request, NULL, NULL, NULL, napi_default, NULL },
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
