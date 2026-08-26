{
  pkgs ? import <nixpkgs> { },
  unpacked,
  version ? "0",
}:
pkgs.callPackage ./fhs.nix { inherit unpacked version; }
