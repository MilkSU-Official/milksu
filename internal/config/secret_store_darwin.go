//go:build darwin && cgo

package config

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>

static CFMutableDictionaryRef milksu_keychain_query(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length
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
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length);
  if (query == NULL) return errSecParam;
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
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
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length);
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
  return status;
}

static OSStatus milksu_keychain_delete(
  const char *service,
  CFIndex service_length,
  const char *account,
  CFIndex account_length
) {
  CFMutableDictionaryRef query = milksu_keychain_query(service, service_length, account, account_length);
  if (query == NULL) return errSecParam;
  OSStatus status = SecItemDelete(query);
  CFRelease(query);
  return status;
}
*/
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

const keychainService = "dev.milksu.app.credentials"

type keychainSecretStore struct{}

func newPlatformSecretStore() secretStore {
	return keychainSecretStore{}
}

func (keychainSecretStore) Get(account string) (string, error) {
	servicePointer := C.CString(keychainService)
	accountPointer := C.CString(account)
	defer C.free(unsafe.Pointer(servicePointer))
	defer C.free(unsafe.Pointer(accountPointer))

	var secretLength C.CFIndex
	var secretPointer unsafe.Pointer
	status := C.milksu_keychain_copy(
		servicePointer,
		C.CFIndex(len(keychainService)),
		accountPointer,
		C.CFIndex(len(account)),
		&secretLength,
		&secretPointer,
	)
	if status == C.errSecItemNotFound {
		return "", errSecretNotFound
	}
	if status != C.errSecSuccess {
		return "", keychainError("read", status)
	}
	defer C.free(secretPointer)
	return string(C.GoBytes(secretPointer, C.int(secretLength))), nil
}

func (keychainSecretStore) Set(account, secret string) error {
	if secret == "" {
		return errors.New("credential must not be empty")
	}
	servicePointer := C.CString(keychainService)
	accountPointer := C.CString(account)
	secretPointer := C.CBytes([]byte(secret))
	defer C.free(unsafe.Pointer(servicePointer))
	defer C.free(unsafe.Pointer(accountPointer))
	defer C.free(secretPointer)

	status := C.milksu_keychain_set(
		servicePointer,
		C.CFIndex(len(keychainService)),
		accountPointer,
		C.CFIndex(len(account)),
		secretPointer,
		C.CFIndex(len(secret)),
	)
	if status != C.errSecSuccess {
		return keychainError("write", status)
	}
	return nil
}

func (keychainSecretStore) Delete(account string) error {
	servicePointer := C.CString(keychainService)
	accountPointer := C.CString(account)
	defer C.free(unsafe.Pointer(servicePointer))
	defer C.free(unsafe.Pointer(accountPointer))

	status := C.milksu_keychain_delete(
		servicePointer,
		C.CFIndex(len(keychainService)),
		accountPointer,
		C.CFIndex(len(account)),
	)
	if status == C.errSecItemNotFound {
		return errSecretNotFound
	}
	if status != C.errSecSuccess {
		return keychainError("delete", status)
	}
	return nil
}

func keychainError(operation string, status C.OSStatus) error {
	return fmt.Errorf("%s macOS Keychain item: OSStatus %d", operation, int32(status))
}
