{
  pkgs,
  unpacked,
  version ? "0",
}:
pkgs.buildFHSEnv {
  pname = "milksu";
  inherit version;
  targetPkgs =
    pkgs: with pkgs; [
      alsa-lib
      at-spi2-atk
      at-spi2-core
      cairo
      cups
      dbus
      expat
      glib
      gtk3
      fontconfig
      freetype
      gdk-pixbuf
      libdrm
      libgbm
      libGL
      libnotify
      libsecret
      libxkbcommon
      mesa
      nss
      nspr
      pango
      udev
      wayland
      xorg.libX11
      xorg.libXcomposite
      xorg.libXdamage
      xorg.libXext
      xorg.libXfixes
      xorg.libXrandr
      xorg.libxcb
    ];
  profile = ''
    export ELECTRON_OZONE_PLATFORM_HINT="''${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
  '';
  extraInstallCommands = ''
    mkdir -p $out/share/applications
    if [ -f ${unpacked}/../milksu.desktop ]; then
      substitute ${unpacked}/../milksu.desktop $out/share/applications/milksu.desktop \
        --replace-fail "Exec=env ELECTRON_OZONE_PLATFORM_HINT=auto milksu %U" "Exec=$out/bin/milksu %U"
    fi
    if [ -f ${unpacked}/milksu.png ]; then
      mkdir -p $out/share/icons/hicolor/256x256/apps $out/share/pixmaps
      cp ${unpacked}/milksu.png $out/share/icons/hicolor/256x256/apps/milksu.png
      cp ${unpacked}/milksu.png $out/share/pixmaps/milksu.png
    fi
  '';
  runScript = "${unpacked}/milksu";
}
