package org.milksu.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Cold canvas + ink primary — aligned with desktop MilkSU surfaces, not purple AI chrome. */
object MilkSUColors {
  val Canvas = Color(0xFFF4F6F8)
  val CanvasDark = Color(0xFF181818)
  val Ink = Color(0xFF141414)
  val InkOnDark = Color(0xFFF0F0F0)
  val BubbleUser = Color(0xFF141414)
  val BubbleAssistant = Color(0xFFEAEBED)
  val BubbleAssistantDark = Color(0xFF2A2A2A)
}

private val LightScheme = lightColorScheme(
  primary = MilkSUColors.Ink,
  onPrimary = Color.White,
  secondary = Color(0xFF5B616A),
  onSecondary = Color.White,
  background = MilkSUColors.Canvas,
  onBackground = MilkSUColors.Ink,
  surface = Color.White,
  onSurface = MilkSUColors.Ink,
  surfaceVariant = Color(0xFFE8EAED),
  onSurfaceVariant = Color(0xFF5B616A),
  outline = Color(0x1A000000),
  error = Color(0xFFB3261E),
)

private val DarkScheme = darkColorScheme(
  primary = MilkSUColors.InkOnDark,
  onPrimary = MilkSUColors.Ink,
  secondary = Color(0xFFA8ADB5),
  onSecondary = MilkSUColors.Ink,
  background = MilkSUColors.CanvasDark,
  onBackground = MilkSUColors.InkOnDark,
  surface = Color(0xFF1C1C1C),
  onSurface = MilkSUColors.InkOnDark,
  surfaceVariant = Color(0xFF2A2A2A),
  onSurfaceVariant = Color(0xFFA8ADB5),
  outline = Color(0x33FFFFFF),
  error = Color(0xFFF2B8B5),
)

@Composable
fun MilkSUTheme(content: @Composable () -> Unit) {
  val dark = isSystemInDarkTheme()
  MaterialTheme(
    colorScheme = if (dark) DarkScheme else LightScheme,
    content = content,
  )
}
