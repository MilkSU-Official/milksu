package envbroker

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const AndroidStudioInstallURL = "https://developer.android.com/studio"

func androidSDKCandidates() []string {
	var roots []string
	for _, key := range []string{"ANDROID_HOME", "ANDROID_SDK_ROOT"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			roots = append(roots, value)
		}
	}
	home, _ := os.UserHomeDir()
	if home != "" {
		roots = append(roots,
			filepath.Join(home, "Library", "Android", "sdk"),
			filepath.Join(home, "Android", "Sdk"),
			filepath.Join(home, "Android", "sdk"),
		)
	}
	if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
		roots = append(roots, filepath.Join(local, "Android", "Sdk"))
	}
	if profile := strings.TrimSpace(os.Getenv("USERPROFILE")); profile != "" {
		roots = append(roots, filepath.Join(profile, "AppData", "Local", "Android", "Sdk"))
	}
	for _, programFiles := range windowsProgramFiles() {
		roots = append(roots, filepath.Join(programFiles, "Android", "android-sdk"))
	}
	roots = append(roots,
		"/opt/android-sdk",
		"/usr/lib/android-sdk",
		"/usr/local/android-sdk",
	)
	return uniqueExistingHint(roots)
}

func androidSDKRoots() []string {
	var roots []string
	for _, root := range androidSDKCandidates() {
		if androidDirExists(root) {
			roots = append(roots, root)
		}
	}
	return roots
}

func androidStudioJavaCandidates() []string {
	var homes []string
	homes = append(homes,
		"/Applications/Android Studio.app/Contents/jbr/Contents/Home",
		"/Applications/Android Studio.app/Contents/jre/Contents/Home",
	)
	matches, _ := filepath.Glob("/Applications/Android Studio*.app/Contents/jbr/Contents/Home")
	homes = append(homes, matches...)
	home, _ := os.UserHomeDir()
	if home != "" {
		homes = append(homes,
			filepath.Join(home, "android-studio", "jbr"),
			filepath.Join(home, ".local", "share", "JetBrains", "Toolbox", "apps", "AndroidStudio", "jbr"),
		)
	}
	homes = append(homes,
		"/opt/android-studio/jbr",
		"/usr/local/android-studio/jbr",
		"/snap/android-studio/current/jbr",
	)
	for _, programFiles := range windowsProgramFiles() {
		homes = append(homes,
			filepath.Join(programFiles, "Android", "Android Studio", "jbr"),
			filepath.Join(programFiles, "Android", "Android Studio", "jre"),
		)
	}
	if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
		homes = append(homes,
			filepath.Join(local, "Programs", "Android Studio", "jbr"),
			filepath.Join(local, "Google", "AndroidStudio", "jbr"),
		)
	}
	return uniqueExistingHint(homes)
}

func osJavaCandidates() []string {
	var homes []string
	if env := validJavaHome(os.Getenv("JAVA_HOME")); env != "" {
		homes = append(homes, env)
	}
	for _, prefix := range []string{"/opt/homebrew/opt", "/usr/local/opt"} {
		homes = append(homes, filepath.Join(prefix, "openjdk", "libexec", "openjdk.jdk", "Contents", "Home"))
		matches, _ := filepath.Glob(filepath.Join(prefix, "openjdk@*", "libexec", "openjdk.jdk", "Contents", "Home"))
		homes = append(homes, matches...)
	}
	jvm, _ := filepath.Glob("/usr/lib/jvm/java-1[7-9]*")
	homes = append(homes, jvm...)
	jvm21, _ := filepath.Glob("/usr/lib/jvm/java-2*")
	homes = append(homes, jvm21...)
	temurin, _ := filepath.Glob("/usr/lib/jvm/temurin-1*")
	homes = append(homes, temurin...)
	for _, programFiles := range windowsProgramFiles() {
		for _, pattern := range []string{
			filepath.Join(programFiles, "Microsoft", "jdk-*"),
			filepath.Join(programFiles, "Eclipse Adoptium", "jdk-*"),
			filepath.Join(programFiles, "Java", "jdk-*"),
			filepath.Join(programFiles, "AdoptOpenJDK", "jdk-*"),
		} {
			matches, _ := filepath.Glob(pattern)
			homes = append(homes, matches...)
		}
	}
	return uniqueExistingHint(homes)
}

func windowsProgramFiles() []string {
	var dirs []string
	for _, key := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			dirs = append(dirs, value)
		}
	}
	if runtime.GOOS == "windows" && len(dirs) == 0 {
		dirs = append(dirs, `C:\Program Files`, `C:\Program Files (x86)`)
	}
	return uniqueExistingHint(dirs)
}

func androidStudioPresent() bool {
	for _, home := range androidStudioJavaCandidates() {
		if validJavaHome(home) != "" || androidDirExists(home) {
			return true
		}
	}
	if runtime.GOOS == "darwin" {
		if androidDirExists("/Applications/Android Studio.app") {
			return true
		}
		matches, _ := filepath.Glob("/Applications/Android Studio*.app")
		if len(matches) > 0 {
			return true
		}
	}
	if _, err := os.Stat(AndroidStudioLaunchPath()); err == nil {
		return true
	}
	return false
}

func AndroidStudioLaunchPath() string {
	switch runtime.GOOS {
	case "darwin":
		matches, _ := filepath.Glob("/Applications/Android Studio*.app")
		if len(matches) > 0 {
			return matches[0]
		}
	case "windows":
		for _, programFiles := range windowsProgramFiles() {
			candidate := filepath.Join(programFiles, "Android", "Android Studio", "bin", "studio64.exe")
			if androidToolExists(candidate) {
				return candidate
			}
		}
		if local := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); local != "" {
			candidate := filepath.Join(local, "Programs", "Android Studio", "bin", "studio64.exe")
			if androidToolExists(candidate) {
				return candidate
			}
		}
	default:
		if path, err := exec.LookPath("android-studio"); err == nil {
			return path
		}
		for _, candidate := range []string{
			"/opt/android-studio/bin/studio.sh",
			"/usr/local/android-studio/bin/studio.sh",
		} {
			if androidToolExists(candidate) {
				return candidate
			}
		}
	}
	return ""
}

func classifySDKSource(root, override string) string {
	root = strings.TrimSpace(root)
	if root == "" {
		return ""
	}
	if override != "" && samePath(root, override) {
		return "settings"
	}
	if env := strings.TrimSpace(os.Getenv("ANDROID_HOME")); env != "" && samePath(root, env) {
		return "env"
	}
	if env := strings.TrimSpace(os.Getenv("ANDROID_SDK_ROOT")); env != "" && samePath(root, env) {
		return "env"
	}
	return "default"
}

func classifyJavaSource(home, override string) string {
	home = strings.TrimSpace(home)
	if home == "" {
		return ""
	}
	if override != "" && samePath(home, override) {
		return "settings"
	}
	lower := strings.ToLower(home)
	if strings.Contains(lower, "android studio") || strings.Contains(lower, "android-studio") || strings.Contains(lower, "androidstudio") {
		return "android-studio"
	}
	if env := validJavaHome(os.Getenv("JAVA_HOME")); env != "" && samePath(home, env) {
		return "env"
	}
	if strings.Contains(lower, "homebrew") || strings.Contains(lower, "/opt/homebrew/") {
		return "homebrew"
	}
	return "os"
}

func samePath(left, right string) bool {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" || right == "" {
		return false
	}
	cleanLeft, errLeft := filepath.Abs(left)
	cleanRight, errRight := filepath.Abs(right)
	if errLeft != nil || errRight != nil {
		return filepath.Clean(left) == filepath.Clean(right)
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(cleanLeft, cleanRight)
	}
	return cleanLeft == cleanRight
}

func androidDirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func uniqueExistingHint(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
