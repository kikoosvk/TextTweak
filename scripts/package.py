"""Build and verify the store ZIP using only Python 3's standard library."""
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
# Deliberate allowlist: never recursively ship a working directory.
FILES = ["manifest.json", "background.js", "content/bootstrap.js",
         "content/state.js", "content/toolbar.js", "content/editor.js",
         *[f"icons/icon-{size}.png" for size in (16, 32, 48, 128)]]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def build():
    payload = {}
    for name in FILES:
        path = SOURCE / name
        require(not path.is_symlink() and path.resolve().is_relative_to(SOURCE.resolve()),
                f"Unsafe runtime path: {name}")
        payload[name] = path.read_bytes()
    manifest = json.loads(payload["manifest.json"])
    version = manifest["version"]
    require(re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}", version)
            and all(int(part) <= 65535 for part in version.split("."))
            and any(int(part) for part in version.split(".")), "Invalid Chrome version")
    require(version == json.loads((ROOT / "package.json").read_text())["version"],
            "Manifest and package.json versions must match")
    require(manifest["name"] == "TextTweak" and manifest["manifest_version"] == 3,
            "Expected TextTweak Manifest V3")
    require(0 < len(manifest["description"]) <= 132, "Invalid short description")
    require(manifest["permissions"] == ["contextMenus"], "Review changed permissions")
    require(not any(key in manifest for key in ("host_permissions", "optional_permissions",
            "optional_host_permissions", "externally_connectable", "web_accessible_resources",
            "update_url", "key", "action", "options_page", "options_ui", "devtools_page",
            "sandbox", "chrome_url_overrides")), "Review new manifest capabilities/resources")
    scripts = manifest["content_scripts"]
    require(len(scripts) == 1, "Review new content scripts")
    script = scripts[0]
    require(script == {"matches": ["http://*/*", "https://*/*"],
            "js": FILES[2:6], "run_at": "document_start", "all_frames": True,
            "world": "ISOLATED"}, "Review changed content-script configuration")
    references = {"manifest.json", manifest["background"]["service_worker"],
                  *script["js"], *manifest["icons"].values()}
    require(references == set(FILES), "Manifest resources differ from release allowlist")
    require(set(manifest["icons"]) == {"16", "32", "48", "128"}, "Missing icon sizes")
    for size, name in manifest["icons"].items():
        png = payload[name]
        require(png[:8] == b"\x89PNG\r\n\x1a\n" and png[12:16] == b"IHDR"
                and struct.unpack(">II", png[16:24]) == (int(size), int(size))
                and png[24:26] == bytes([8, 6]), f"Expected {size}px RGBA PNG: {name}")
    output = ROOT / "dist" / f"TextTweak-{version}.zip"
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix(".zip.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in payload.items():
                entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, data)
        with zipfile.ZipFile(temporary) as archive:
            require(archive.namelist() == FILES, "Unexpected ZIP entries")
            require(archive.testzip() is None, "ZIP CRC verification failed")
            for name, data in payload.items():
                require(archive.read(name) == data, f"ZIP bytes differ: {name}")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Validated {len(FILES)} runtime files; manifest.json is at ZIP root.")
    print(output)
    print(f"SHA-256: {hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    build()
