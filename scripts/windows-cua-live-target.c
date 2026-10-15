#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

static const wchar_t kClassName[] = L"MilkSUCuaLiveTarget";

static LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_DESTROY || message == WM_CLOSE) {
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

int main(void) {
  HINSTANCE instance = GetModuleHandleW(NULL);
  const wchar_t *title = L"MilkSU CUA Live";
  int argc = 0;
  LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argv && argc > 1 && argv[1] && argv[1][0] != L'\0') title = argv[1];

  WNDCLASSEXW class = {0};
  class.cbSize = sizeof(class);
  class.lpfnWndProc = WndProc;
  class.hInstance = instance;
  class.hCursor = LoadCursorW(NULL, IDC_ARROW);
  class.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  class.lpszClassName = kClassName;
  if (!RegisterClassExW(&class)) return 2;

  HWND hwnd = CreateWindowExW(
    0,
    kClassName,
    title,
    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
    CW_USEDEFAULT,
    CW_USEDEFAULT,
    640,
    400,
    NULL,
    NULL,
    instance,
    NULL
  );
  if (!hwnd) return 3;

  HWND edit = CreateWindowExW(
    WS_EX_CLIENTEDGE,
    L"EDIT",
    L"",
    WS_CHILD | WS_VISIBLE | WS_TABSTOP | WS_BORDER | ES_MULTILINE | ES_AUTOVSCROLL,
    12,
    12,
    600,
    320,
    hwnd,
    (HMENU)1,
    instance,
    NULL
  );
  if (!edit) return 4;

  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);

  MSG message;
  while (GetMessageW(&message, NULL, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  if (argv) LocalFree(argv);
  return 0;
}
