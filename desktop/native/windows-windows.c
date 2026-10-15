#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _MSC_VER
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "kernel32.lib")
#endif

#define PROCESS_QUERY_LIMITED_INFORMATION_VALUE 0x1000
#define MAX_WINDOWS_EXECUTABLE_PATH 32768
#define MAX_WINDOW_TITLE_CHARS 4096
#define MAX_NAME_CHARS 256

typedef struct {
  char *name;
  char *bundle_id;
  char *title;
  char *executable;
  DWORD pid;
  int64_t window_id;
} window_entry;

typedef struct {
  window_entry *items;
  size_t count;
  size_t cap;
} window_list;

static char *wchar_to_utf8(const WCHAR *wide) {
  int bytes;
  char *out;
  if (wide == NULL) return NULL;
  bytes = WideCharToMultiByte(CP_UTF8, 0, wide, -1, NULL, 0, NULL, NULL);
  if (bytes <= 0) return NULL;
  out = (char *)malloc((size_t)bytes);
  if (out == NULL) return NULL;
  if (WideCharToMultiByte(CP_UTF8, 0, wide, -1, out, bytes, NULL, NULL) <= 0) {
    free(out);
    return NULL;
  }
  return out;
}

static char *dup_utf8(const char *value) {
  size_t length;
  char *out;
  if (value == NULL) return NULL;
  length = strlen(value);
  out = (char *)malloc(length + 1);
  if (out == NULL) return NULL;
  memcpy(out, value, length + 1);
  return out;
}

static void basename_stem_utf8(const char *path, char *out, size_t out_size) {
  const char *base = path;
  const char *p;
  const char *dot = NULL;
  size_t n = 0;
  if (out_size == 0) return;
  for (p = path; *p; p++) {
    if (*p == '\\' || *p == '/') base = p + 1;
  }
  for (p = base; *p && n + 1 < out_size; p++) {
    if (*p == '.') dot = out + n;
    out[n++] = *p;
  }
  out[n] = 0;
  if (dot != NULL && dot != out) *dot = 0;
}

static void trim_inplace(char *value) {
  char *start;
  char *end;
  size_t length;
  if (value == NULL) return;
  start = value;
  while (*start == ' ' || *start == '\t' || *start == '\r' || *start == '\n') start++;
  if (start != value) memmove(value, start, strlen(start) + 1);
  length = strlen(value);
  end = value + length;
  while (end > value && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r' || end[-1] == '\n')) {
    end--;
  }
  *end = 0;
}

static int valid_bundle_id(const char *value) {
  size_t length;
  const unsigned char *p;
  if (value == NULL) return 0;
  length = strlen(value);
  if (length == 0 || length > 256) return 0;
  for (p = (const unsigned char *)value; *p; p++) {
    unsigned char c = *p;
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-') {
      continue;
    }
    return 0;
  }
  return 1;
}

static void windows_application_identifier(const char *name, char *out, size_t out_size) {
  size_t n;
  const unsigned char *p;
  if (out_size == 0) return;
  snprintf(out, out_size, "win32.");
  n = strlen(out);
  for (p = (const unsigned char *)name; *p && n + 1 < out_size; p++) {
    unsigned char c = *p;
    if (c >= 'A' && c <= 'Z') c = (unsigned char)(c - 'A' + 'a');
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-') {
      out[n++] = (char)c;
    } else {
      out[n++] = '-';
    }
  }
  out[n] = 0;
  while (n > 0 && out[n - 1] == '-') {
    out[--n] = 0;
  }
}

static int process_executable_path(DWORD pid, WCHAR *buffer, DWORD buffer_chars) {
  HANDLE handle;
  DWORD size;
  BOOL ok;
  if (pid <= 1 || buffer == NULL || buffer_chars == 0) return 0;
  handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION_VALUE, FALSE, pid);
  if (handle == NULL) return 0;
  size = buffer_chars;
  ok = QueryFullProcessImageNameW(handle, 0, buffer, &size);
  CloseHandle(handle);
  return ok && size > 0;
}

static int window_list_push(window_list *list, window_entry *entry) {
  window_entry *items;
  size_t next;
  if (list->count >= list->cap) {
    next = list->cap == 0 ? 16 : list->cap * 2;
    items = (window_entry *)realloc(list->items, next * sizeof(*items));
    if (items == NULL) return 0;
    list->items = items;
    list->cap = next;
  }
  list->items[list->count++] = *entry;
  return 1;
}

static void window_entry_free(window_entry *entry) {
  if (entry == NULL) return;
  free(entry->name);
  free(entry->bundle_id);
  free(entry->title);
  free(entry->executable);
}

static void window_list_free(window_list *list) {
  size_t i;
  if (list == NULL) return;
  for (i = 0; i < list->count; i++) window_entry_free(&list->items[i]);
  free(list->items);
  list->items = NULL;
  list->count = 0;
  list->cap = 0;
}

static BOOL CALLBACK enum_windows_proc(HWND hwnd, LPARAM lparam) {
  window_list *list = (window_list *)lparam;
  int length;
  WCHAR title_w[MAX_WINDOW_TITLE_CHARS + 2];
  WCHAR executable_w[MAX_WINDOWS_EXECUTABLE_PATH];
  DWORD pid = 0;
  char *executable;
  char name[MAX_NAME_CHARS];
  char identifier[MAX_NAME_CHARS + 8];
  char *title;
  window_entry entry;
  if (!IsWindowVisible(hwnd)) return TRUE;
  length = GetWindowTextLengthW(hwnd);
  if (length > MAX_WINDOW_TITLE_CHARS) return TRUE;
  title_w[0] = 0;
  if (length > 0) {
    if (GetWindowTextW(hwnd, title_w, length + 1) <= 0) title_w[0] = 0;
  }
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid <= 1) return TRUE;
  if (!process_executable_path(pid, executable_w, MAX_WINDOWS_EXECUTABLE_PATH)) return TRUE;
  executable = wchar_to_utf8(executable_w);
  if (executable == NULL || executable[0] == 0) {
    free(executable);
    return TRUE;
  }
  basename_stem_utf8(executable, name, sizeof(name));
  trim_inplace(name);
  windows_application_identifier(name, identifier, sizeof(identifier));
  if (!valid_bundle_id(identifier)) {
    free(executable);
    return TRUE;
  }
  title = wchar_to_utf8(title_w);
  if (title == NULL) title = dup_utf8("");
  trim_inplace(title);
  if (title[0] == 0) {
    free(title);
    title = dup_utf8(name);
  }
  if (title == NULL || title[0] == 0 || name[0] == 0) {
    free(title);
    free(executable);
    return TRUE;
  }
  memset(&entry, 0, sizeof(entry));
  entry.name = dup_utf8(name);
  entry.bundle_id = dup_utf8(identifier);
  entry.title = title;
  entry.executable = executable;
  entry.pid = pid;
  entry.window_id = (int64_t)(intptr_t)hwnd;
  if (entry.name == NULL || entry.bundle_id == NULL) {
    window_entry_free(&entry);
    return TRUE;
  }
  if (!window_list_push(list, &entry)) {
    window_entry_free(&entry);
  }
  return TRUE;
}

static napi_status set_utf8_property(napi_env env, napi_value object, const char *name, const char *value) {
  napi_value js;
  if (value == NULL) return napi_ok;
  if (napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &js) != napi_ok) return napi_generic_failure;
  return napi_set_named_property(env, object, name, js);
}

static napi_value empty_array(napi_env env) {
  napi_value result;
  if (napi_create_array_with_length(env, 0, &result) != napi_ok) return NULL;
  return result;
}

static napi_value list_windows(napi_env env, napi_callback_info info) {
  window_list list;
  napi_value targets;
  uint32_t i;
  (void)info;
  memset(&list, 0, sizeof(list));
  if (!EnumWindows(enum_windows_proc, (LPARAM)&list)) {
    window_list_free(&list);
    return empty_array(env);
  }
  if (napi_create_array(env, &targets) != napi_ok) {
    window_list_free(&list);
    return empty_array(env);
  }
  {
    uint32_t next = 0;
    for (i = 0; i < list.count; i++) {
      napi_value entry;
      napi_value pid_value;
      napi_value window_id_value;
      window_entry *item = &list.items[i];
      if (
        napi_create_object(env, &entry) != napi_ok ||
        napi_create_int64(env, (int64_t)item->pid, &pid_value) != napi_ok ||
        napi_create_int64(env, item->window_id, &window_id_value) != napi_ok ||
        napi_set_named_property(env, entry, "pid", pid_value) != napi_ok ||
        napi_set_named_property(env, entry, "windowId", window_id_value) != napi_ok ||
        set_utf8_property(env, entry, "name", item->name) != napi_ok ||
        set_utf8_property(env, entry, "bundleId", item->bundle_id) != napi_ok ||
        set_utf8_property(env, entry, "windowTitle", item->title) != napi_ok ||
        set_utf8_property(env, entry, "executablePath", item->executable) != napi_ok
      ) {
        continue;
      }
      if (napi_set_element(env, targets, next, entry) == napi_ok) next += 1;
    }
  }
  window_list_free(&list);
  return targets;
}

static napi_value host_executable(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_value result;
  int64_t pid = 0;
  WCHAR path_w[MAX_WINDOWS_EXECUTABLE_PATH];
  char *utf8;
  napi_create_string_utf8(env, "", NAPI_AUTO_LENGTH, &result);
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    return result;
  }
  if (napi_get_value_int64(env, argv[0], &pid) != napi_ok || pid <= 1) {
    return result;
  }
  if (!process_executable_path((DWORD)pid, path_w, MAX_WINDOWS_EXECUTABLE_PATH)) {
    return result;
  }
  utf8 = wchar_to_utf8(path_w);
  if (utf8 == NULL) return result;
  napi_create_string_utf8(env, utf8, NAPI_AUTO_LENGTH, &result);
  free(utf8);
  return result;
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
