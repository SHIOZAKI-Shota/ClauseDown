use std::env;
use std::path::PathBuf;
use std::process::Command;

fn xcrun(args: &[&str]) -> String {
    let out = Command::new("xcrun").args(args).output().expect("xcrun");
    assert!(out.status.success(), "xcrun {:?} failed", args);
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

fn swift() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        a => a,
    }
    .to_string();
    let lib = out.join("libkeychip.a");
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-emit-library",
            "-static",
            "-parse-as-library",
            "-module-name",
            "KeyChip",
            "-O",
        ])
        .args(["-target", &format!("{arch}-apple-macos12.0")])
        .arg("swift/KeyChip.swift")
        .arg("-o")
        .arg(&lib)
        .status()
        .expect("swiftc");
    assert!(status.success(), "swiftc failed");
    let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = PathBuf::from(xcrun(&["-f", "swiftc"]));
    let toolchain = swiftc
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}", toolchain.display());
    println!("cargo:rustc-link-lib=static=keychip");
    for f in ["Foundation", "Security", "LocalAuthentication", "CryptoKit"] {
        println!("cargo:rustc-link-lib=framework={f}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rerun-if-changed=swift/KeyChip.swift");
}

fn main() {
    napi_build::setup();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/{}.node", env!("CARGO_PKG_NAME"));
        swift();
    }
}
