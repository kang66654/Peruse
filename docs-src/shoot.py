import os
from pathlib import Path

from playwright.sync_api import sync_playwright

CANDIDATES = [
    Path(os.environ["LOCALAPPDATA"]) / r"ms-playwright",
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
]


def find_chrome():
    ms_dir = CANDIDATES[0]
    if ms_dir.exists():
        hits = sorted(ms_dir.glob(r"chromium-*\chrome-win\chrome.exe"))
        if hits:
            return str(hits[-1])
    for c in CANDIDATES[1:]:
        if c.exists():
            return str(c)
    raise RuntimeError("no browser executable found")


DOCS = r"C:\Users\kangy\Desktop\Peruse项目\peruse-extension\docs"
SRC = r"C:\Users\kangy\Desktop\Peruse项目\peruse-extension\docs-src"
PROTO = r"C:\Users\kangy\Desktop\Peruse项目\前端效果图\紫色\html"

JOBS = [
    # (html, out, selector or None, viewport w, h, scale)
    (os.path.join(SRC, "hero.html"), os.path.join(DOCS, "images", "hero.png"), ".stage", 1260, 900, 2),
    (os.path.join(SRC, "architecture.html"), os.path.join(DOCS, "images", "architecture.png"), ".stage", 1260, 900, 2),
    (os.path.join(SRC, "social.html"), os.path.join(DOCS, "images", "social-preview.png"), ".stage", 1260, 700, 2),
    (os.path.join(PROTO, "05-digest.html"), os.path.join(DOCS, "images", "ui-digest.png"), None, 1280, 900, 2),
    (os.path.join(PROTO, "06-stats.html"), os.path.join(DOCS, "images", "ui-stats.png"), None, 1280, 900, 2),
    (os.path.join(PROTO, "07-history.html"), os.path.join(DOCS, "images", "ui-history.png"), None, 1280, 900, 2),
    (os.path.join(PROTO, "08-settings-model.html"), os.path.join(DOCS, "images", "ui-settings.png"), None, 1280, 900, 2),
    (os.path.join(PROTO, "04-popup-daily.html"), os.path.join(DOCS, "images", "ui-popup.png"), None, 420, 640, 3),
]


def main():
    exe = find_chrome()
    print("browser:", exe)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe)
        for html, out, selector, vw, vh, scale in JOBS:
            Path(out).parent.mkdir(parents=True, exist_ok=True)
            page = browser.new_page(viewport={"width": vw, "height": vh}, device_scale_factor=scale)
            page.goto(Path(html).as_uri())
            page.wait_for_timeout(1100)
            if selector:
                page.locator(selector).first.screenshot(path=out)
            else:
                page.screenshot(path=out, full_page=True)
            print("saved:", os.path.basename(out), os.path.getsize(out), "bytes")
            page.close()
        browser.close()


if __name__ == "__main__":
    main()
