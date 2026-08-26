{
  description = "MilkSU Linux desktop for NixOS GNOME and Hyprland";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      unpackedEnv = builtins.getEnv "MILKSU_LINUX_UNPACKED";
      unpacked =
        if unpackedEnv != "" then /. + unpackedEnv
        else if builtins.pathExists (self + "/unpacked/milksu") then self + "/unpacked"
        else throw "Set MILKSU_LINUX_UNPACKED to the linux-unpacked directory (nix --impure build).";
      version =
        let raw = builtins.getEnv "MILKSU_VERSION";
        in if raw != "" then raw else "0";
    in {
      packages.${system}.default = pkgs.callPackage ./fhs.nix {
        inherit unpacked version;
      };
      packages.${system}.milksu = self.packages.${system}.default;
    };
}
