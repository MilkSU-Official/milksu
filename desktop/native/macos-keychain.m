#import <CoreFoundation/CoreFoundation.h>
#import <Security/Security.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char KEYCHAIN_SERVICE[] = "dev.milksu.app.credentials";

static CFMutableDictionaryRef milksu_keychain_query(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length,
  Boolean use_data_protection
) {
  CFStringRef service_string = CFStringCreateWithBytes(
    kCFAllocatorDefault,
    (const UInt8 *)service,
    service_length,
    kCFStringEncodingUTF8,
    false
  );
  CFStringRef account_string = CFStringCreateWithBytes(
    kCFAllocatorDefault,
    (const UInt8 *)account,
    account_length,
    kCFStringEncodingUTF8,
    false
  );
  if (service_string == NULL || account_string == NULL) {
    if (service_string != NULL) CFRelease(service_string);
    if (account_string != NULL) CFRelease(account_string);
    return NULL;
  }

  CFMutableDictionaryRef query = CFDictionaryCreateMutable(
    kCFAllocatorDefault,
    0,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service_string);
  CFDictionarySetValue(query, kSecAttrAccount, account_string);
  if (use_data_protection) {
    if (__builtin_available(macOS 10.15, *)) {
      CFDictionarySetValue(query, kSecUseDataProtectionKeychain, kCFBooleanTrue);
    }
  }
  CFRelease(service_string);
  CFRelease(account_string);
  return query;
}

static OSStatus milksu_keychain_copy(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length,
  CFIndex *secret_length,
  void **secret
) {
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length, true);
  if (query == NULL) return errSecParam;
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status == errSecItemNotFound || status == errSecMissingEntitlement) {
    query = milksu_keychain_query(service, service_length, account, account_length, false);
    if (query == NULL) return errSecParam;
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
    status = SecItemCopyMatching(query, &result);
    CFRelease(query);
  }
  if (status != errSecSuccess) return status;

  CFDataRef data = (CFDataRef)result;
  CFIndex length = CFDataGetLength(data);
  void *copy = malloc((size_t)(length > 0 ? length : 1));
  if (copy == NULL) {
    CFRelease(data);
    return errSecAllocate;
  }
  if (length > 0) {
    CFDataGetBytes(data, CFRangeMake(0, length), (UInt8 *)copy);
  }
  CFRelease(data);
  *secret_length = length;
  *secret = copy;
  return errSecSuccess;
}

static OSStatus milksu_keychain_set(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length,
  const void *secret,
  CFIndex secret_length
) {
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length, true);
  if (query == NULL) return errSecParam;
  CFDataRef secret_data = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)secret, secret_length);
  if (secret_data == NULL) {
    CFRelease(query);
    return errSecAllocate;
  }

  const void *keys[] = { kSecValueData };
  const void *values[] = { secret_data };
  CFDictionaryRef attributes = CFDictionaryCreate(
    kCFAllocatorDefault,
    keys,
    values,
    1,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  OSStatus status = SecItemUpdate(query, attributes);
  CFRelease(attributes);
  if (status == errSecItemNotFound) {
    CFDictionarySetValue(query, kSecValueData, secret_data);
    CFDictionarySetValue(query, kSecAttrAccessible, kSecAttrAccessibleWhenUnlocked);
    status = SecItemAdd(query, NULL);
  }
  CFRelease(secret_data);
  CFRelease(query);
  // Ad-hoc development builds can report errSecAuthFailed rather than
  // errSecMissingEntitlement when adding to the data-protection Keychain.
  // Retry the ordinary login Keychain before treating that as a real
  // authentication failure.
  if (status == errSecMissingEntitlement || status == errSecAuthFailed) {
    query = milksu_keychain_query(service, service_length, account, account_length, false);
    if (query == NULL) return errSecParam;
    secret_data = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)secret, secret_length);
    if (secret_data == NULL) {
      CFRelease(query);
      return errSecAllocate;
    }
    const void *legacy_keys[] = { kSecValueData };
    const void *legacy_values[] = { secret_data };
    attributes = CFDictionaryCreate(
      kCFAllocatorDefault,
      legacy_keys,
      legacy_values,
      1,
      &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks
    );
    status = SecItemUpdate(query, attributes);
    CFRelease(attributes);
    if (status == errSecItemNotFound) {
      CFDictionarySetValue(query, kSecValueData, secret_data);
      status = SecItemAdd(query, NULL);
    }
    CFRelease(secret_data);
    CFRelease(query);
  }
  return status;
}

static OSStatus milksu_keychain_delete(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length
) {
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length, true);
  if (query == NULL) return errSecParam;
  OSStatus status = SecItemDelete(query);
  CFRelease(query);
  query = milksu_keychain_query(service, service_length, account, account_length, false);
  if (query == NULL) return status == errSecSuccess ? errSecSuccess : errSecParam;
  OSStatus legacy_status = SecItemDelete(query);
  CFRelease(query);
  if (status == errSecSuccess || legacy_status == errSecSuccess) return errSecSuccess;
  if (status == errSecMissingEntitlement) return legacy_status;
  if (status != errSecItemNotFound) return status;
  return legacy_status;
}

static char *copy_utf8(napi_env env, napi_value value, size_t *length_out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return NULL;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return NULL;
  char *buffer = malloc(length + 1);
  if (buffer == NULL) return NULL;
  if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) != napi_ok) {
    free(buffer);
    return NULL;
  }
  if (length_out) *length_out = length;
  return buffer;
}

static void throw_keychain_error(napi_env env, const char *operation, OSStatus status) {
  char message[384];
  if (status == errSecAuthFailed) {
    snprintf(
      message,
      sizeof(message),
      "%s macOS Keychain item: authentication failed; unlock the login Keychain or retry from the signed MilkSU app (OSStatus %d)",
      operation,
      (int)status
    );
  } else if (status == errSecInteractionNotAllowed) {
    snprintf(
      message,
      sizeof(message),
      "%s macOS Keychain item: user interaction is not allowed in the current session (OSStatus %d)",
      operation,
      (int)status
    );
  } else {
    snprintf(
      message,
      sizeof(message),
      "%s macOS Keychain item: OSStatus %d",
      operation,
      (int)status
    );
  }
  napi_throw_error(env, NULL, message);
}

static napi_value keychain_get(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_type_error(env, NULL, "get(account) requires an account");
    return NULL;
  }

  size_t account_length = 0;
  char *account = copy_utf8(env, argv[0], &account_length);
  if (account == NULL) {
    napi_throw_type_error(env, NULL, "account must be a string");
    return NULL;
  }

  CFIndex secret_length = 0;
  void *secret = NULL;
  OSStatus status = milksu_keychain_copy(
    KEYCHAIN_SERVICE,
    (CFIndex)(sizeof(KEYCHAIN_SERVICE) - 1),
    account,
    (CFIndex)account_length,
    &secret_length,
    &secret
  );
  free(account);
  if (status == errSecItemNotFound) {
    napi_throw_error(env, NULL, "credential not found");
    return NULL;
  }
  if (status != errSecSuccess) {
    throw_keychain_error(env, "read", status);
    return NULL;
  }

  napi_value result;
  napi_status created = napi_create_string_utf8(
    env,
    secret_length > 0 ? (const char *)secret : "",
    secret_length > 0 ? (size_t)secret_length : 0,
    &result
  );
  free(secret);
  if (created != napi_ok) {
    napi_throw_error(env, NULL, "could not encode Keychain secret");
    return NULL;
  }
  return result;
}

static napi_value keychain_set(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 2) {
    napi_throw_type_error(env, NULL, "set(account, secret) requires an account and secret");
    return NULL;
  }

  size_t account_length = 0;
  char *account = copy_utf8(env, argv[0], &account_length);
  if (account == NULL) {
    napi_throw_type_error(env, NULL, "account must be a string");
    return NULL;
  }
  size_t secret_length = 0;
  char *secret = copy_utf8(env, argv[1], &secret_length);
  if (secret == NULL) {
    free(account);
    napi_throw_type_error(env, NULL, "secret must be a string");
    return NULL;
  }

  OSStatus status = milksu_keychain_set(
    KEYCHAIN_SERVICE,
    (CFIndex)(sizeof(KEYCHAIN_SERVICE) - 1),
    account,
    (CFIndex)account_length,
    secret,
    (CFIndex)secret_length
  );
  free(account);
  free(secret);
  if (status != errSecSuccess) {
    throw_keychain_error(env, "write", status);
    return NULL;
  }

  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value keychain_delete(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    napi_throw_type_error(env, NULL, "delete(account) requires an account");
    return NULL;
  }

  size_t account_length = 0;
  char *account = copy_utf8(env, argv[0], &account_length);
  if (account == NULL) {
    napi_throw_type_error(env, NULL, "account must be a string");
    return NULL;
  }

  OSStatus status = milksu_keychain_delete(
    KEYCHAIN_SERVICE,
    (CFIndex)(sizeof(KEYCHAIN_SERVICE) - 1),
    account,
    (CFIndex)account_length
  );
  free(account);
  if (status == errSecItemNotFound) {
    napi_throw_error(env, NULL, "credential not found");
    return NULL;
  }
  if (status != errSecSuccess) {
    throw_keychain_error(env, "delete", status);
    return NULL;
  }

  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "get", NULL, keychain_get, NULL, NULL, NULL, napi_default, NULL },
    { "set", NULL, keychain_set, NULL, NULL, NULL, napi_default, NULL },
    { "delete", NULL, keychain_delete, NULL, NULL, NULL, napi_default, NULL },
  };
  if (napi_define_properties(env, exports, 3, properties) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
