"""Build an arm64 APK with an explicitly staged backend; no local credentials."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGING = ROOT / "android/app/build/generated/python"


def check_runtime() -> None:
    # Run the staged app against Android's pinned dependency versions. Gradle
    # compilation alone cannot catch import-time FastAPI/Pydantic errors.
    environment = ROOT / 'build/android-runtime-check'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.is_file():
        venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                    '-r', str(ROOT / 'android/requirements.txt'), '--index-url',
                    'https://pypi.tuna.tsinghua.edu.cn/simple'], check=True)
    subprocess.run([str(python), str(ROOT / 'scripts/check_runtime.py'), '--android',
                    '--source-dir', str(STAGING)], cwd=ROOT, check=True)


class MobileHtmlError(RuntimeError):
    """移动端页面改写没有命中预期标记。

    为什么必须报错而不是静默跳过：历史上这里是一条
    `html.replace('<link ... /static/desktop.css />', ...)` —— 后来控制台把样式
    改挂到 `/admin/assets/desktop.css?v=…`，这条替换就再也没命中过，而
    `str.replace` 找不到目标时**不抛异常**。结果 mobile.css 从来没被打进
    APK，设置页（只在移动端存在的那一版）整屏没有样式。构建时发现不了，
    只有装到手机上才看得见。
    """


def _replace_once(html: str, old: str, new: str, label: str) -> str:
    if old not in html:
        raise MobileHtmlError(
            f"移动端改写未命中：{label}（期望片段 {old!r}）。"
            "控制台模板改过结构后，请同步更新 scripts/build_android.py。")
    return html.replace(old, new, 1)


def _sub_once(html: str, pattern: str, repl, label: str, flags=re.S) -> str:
    result, count = re.subn(pattern, repl, html, flags=flags)
    if not count:
        raise MobileHtmlError(
            f"移动端改写未命中：{label}（期望正则 {pattern!r}）。"
            "控制台模板改过结构后，请同步更新 scripts/build_android.py。")
    return result


def mobile_html(html: str) -> str:
    """改写控制台（index.html 与 js/console/*.js 按加载顺序拼接后的文本）。"""
    # --- 移除桌面专属面板 -------------------------------------------------
    # 导航是 js/console/05-nav.js 的分组（侧栏 data-nav + 子标签），不再有
    # data-tab="client" / "settings" 的侧栏按钮：从「系统」组里去掉这两页，
    # 同步页由移动端设置页接管，排到组内第一个、改名「设置」。
    html = _replace_once(html, 'tabs: ["settings", "client", "schedules", "sync", "maintenance"]',
                         'tabs: ["sync", "schedules", "maintenance"]',
                         '「系统」分组去掉 client / settings')
    html = _replace_once(html, 'sync: "同步"', 'sync: "设置"', '子标签「同步」→「设置」')
    html = _sub_once(html, r'<section id="panel-client".*?</section>',
                     '', '移除「客户端参数」面板')
    html = _sub_once(html, r'<section id="panel-settings".*?</section>',
                     '', '移除「管理员设置」面板')
    settings = (ROOT / "android/web/settings.html").read_text(encoding="utf-8")
    html = _sub_once(html, r'<section id="panel-sync".*?</section>',
                     lambda _: settings, '用移动端设置页替换「同步设置」')

    # --- 移除桌面专属脚本 -------------------------------------------------
    html = _sub_once(html, r'/\* ==================== 线上同步设置.*?'
                           r'(?=/\* ==================== 客户端兼容参数)',
                     'function loadSyncConfig() {}\n\n', '替换「线上同步设置」脚本')
    html = _sub_once(html, r'<button\b[^>]*onclick="scanLocal\(\)".*?</button>',
                     '', '移除「扫描本机」按钮')
    html = _sub_once(html, r'^.*\[`injectAcc\(.*\n', '', '移除「注入本机」菜单项', flags=re.M)
    html = _sub_once(html, r'async function injectAcc\(.*?(?=/\* 猫猫旅行)',
                     '', '移除 injectAcc 实现')
    html = _sub_once(html, r'/\* 扫描本机账号.*?(?=async function refreshAll\()',
                     '', '移除扫描本机账号实现')
    html = _sub_once(html, r'/\* ==================== 客户端兼容参数.*?'
                           r'(?=/\* ==================== 设置)',
                     '', '移除客户端参数脚本')
    html = _replace_once(html, ',"client"', '', 'TABS 去掉 client')
    html = _replace_once(html, ',"settings"', '', 'TABS 去掉 settings')
    html = _sub_once(html, r'^.*if \(name === "client"\).*\n', '', '去掉 client 面板加载',
                     flags=re.M)
    html = _sub_once(html, r'^.*if \(name === "settings"\).*\n', '', '去掉 settings 面板加载',
                     flags=re.M)

    # --- 文案与凭证提示 ---------------------------------------------------
    html = _replace_once(html, '登录新账号，或从本机与备份中恢复已有账号。',
                         '手机号登录或浏览器授权，账号保存在这台手机。', '账号页文案')
    html = _replace_once(html, '新版加密、旧版明文及 .info.bak-时间戳备份',
                         '旧版明文及 .info.bak-时间戳备份', '导入说明文案')
    credential_note = ('<p class="text-xs text-slate-500 mb-2">新版 Windows 加密凭证请先在'
                       '电脑账号管理页导出“系统明文备份”后再导入，或使用手机号授权登录。</p>')
    for marker in ('<input id="upFile"', '<textarea id="reauthJson"'):
        html = _replace_once(html, marker, credential_note + marker,
                             f'凭证提示（{marker}）')

    # --- 挂上移动端样式与脚本 ---------------------------------------------
    #
    # 用 `</head>` 做锚点而不是匹配某条 `<link>`：后者会随控制台改版漂移
    # （这次就是 `/static/desktop.css` → `/admin/assets/desktop.css?v=…`）。
    # mobile.css 必须排在全部桌面样式之后，才能覆盖 `.mobile-mode` 下的规则。
    html = _replace_once(
        html, '</head>',
        '<link rel="stylesheet" href="/static/mobile.css" />\n</head>',
        '注入 mobile.css')
    html = _replace_once(
        html, '</body>',
        '<script src="/static/mobile.js"></script>'
        '<script src="/static/mobile_settings.js"></script>\n</body>',
        '注入 mobile.js / mobile_settings.js')
    return html


# 控制台脚本拆在 admin/console/js/console/ 下，按文件名顺序加载（index.html
# 里的 <script> 顺序与之一致）。改写规则写于脚本还内联在 index.html 的时候，
# 所以这里按加载顺序把它们拼回一份文本跑同一套规则，再按分隔符拆回各文件：
# 规则不用关心某段代码现在落在哪个文件，以后再挪文件也不会失配。
_FILE_MARK = "\n/*@@MIRAIHUB-MOBILE-FILE:{}@@*/\n"


def mobile_console(console_dir: Path) -> None:
    files = [console_dir / "index.html", *sorted((console_dir / "js/console").glob("*.js"))]
    names = [str(f.relative_to(console_dir)) for f in files]
    combined = "".join(_FILE_MARK.format(name) + f.read_text(encoding="utf-8")
                       for name, f in zip(names, files))
    combined = mobile_html(combined)
    parts = re.split(r"\n/\*@@MIRAIHUB-MOBILE-FILE:(.+?)@@\*/\n", combined)
    # parts = ["", name1, text1, name2, text2, ...]；某条正则若跨文件吞掉了分隔符，
    # 文件数或顺序就对不上 —— 宁可构建失败，也不要静默写坏文件。
    if parts[0] or parts[1::2] != names:
        raise MobileHtmlError("移动端改写跨越了控制台文件边界，请收窄 scripts/build_android.py 中的正则。")
    for name, text in zip(parts[1::2], parts[2::2]):
        (console_dir / name).write_text(text, encoding="utf-8")


def prepare() -> None:
    # Do not allow a symlink or changed working directory to redirect recursive cleanup.
    staging = STAGING.resolve()
    allowed = (ROOT / "android/app/build").resolve()
    if not staging.is_relative_to(allowed) or staging != allowed / "generated/python":
        raise RuntimeError("Unexpected Android staging path")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for path in (ROOT / "admin").rglob("*.py"):
        relative = path.relative_to(ROOT)
        if path.name in ("app_source.py",):
            continue
        target = staging / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    for name in ("upstream_compat.py", "anthropic_adapter.py", "responses_adapter.py",
                 "responses_projection.py", "desensitize.py", "repository_instructions.py", "wb_install.py", "converter.py", "model_metadata.py"):
        shutil.copy2(ROOT / name, staging / name)
    (staging / "desktop/assets").mkdir(parents=True)
    for name in ("__init__.py", "common.py", "runtime.py", "updates.py"):
        shutil.copy2(ROOT / "desktop" / name, staging / "desktop" / name)
    shutil.copy2(ROOT / "desktop/assets/app.svg", staging / "desktop/assets/app.svg")
    metadata = json.loads((ROOT / "desktop/version.json").read_text(encoding="utf-8"))
    metadata["asset"] = "miraihub-{version}-android-arm64.apk"
    (staging / "desktop/version.json").write_text(json.dumps(metadata), encoding="utf-8")
    shutil.copytree(ROOT / "admin/static", staging / "admin/static")
    shutil.copytree(ROOT / "admin/console", staging / "admin/console")
    shutil.copytree(ROOT / "admin/data", staging / "admin/data")
    mobile_console(staging / "admin/console")
    for name in ("mobile.js", "mobile.css", "mobile_settings.js"):
        shutil.copy2(ROOT / "android/web" / name, staging / "admin/static" / name)
    for name in ("android_runtime.py", "mobile_http.py"):
        shutil.copy2(ROOT / "android/python" / name, staging / name)
    shutil.copy2(ROOT / "LICENSE", staging / "LICENSE")
    print("Prepared mobile backend and UI (no desktop parameter page or scan tools)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--with-debug", action="store_true", help="Also build the isolated emulator debug APK")
    parser.add_argument("--gradle", help="Gradle 8.11.1 executable")
    parser.add_argument("--jdk", help="JDK 17 directory")
    parser.add_argument("--sdk", help="Android SDK directory")
    args = parser.parse_args()
    prepare()
    if args.prepare_only:
        return
    check_runtime()
    env = dict(os.environ, WB_ANDROID_BUILD_PYTHON=sys.executable)
    if args.jdk:
        env["JAVA_HOME"] = str(Path(args.jdk).resolve())
    if args.sdk:
        env["ANDROID_HOME"] = str(Path(args.sdk).resolve())
    if env.get("JAVA_HOME"):
        env["PATH"] = str(Path(env["JAVA_HOME"]) / "bin") + os.pathsep + env.get("PATH", "")
    gradle = args.gradle or shutil.which("gradle")
    if not gradle:
        raise SystemExit("Set --gradle to Gradle 8.11.1 and provide JDK 17 / Android SDK")
    # Keep one private signing identity for all upgrades. Never upload these files.
    signing = ROOT / "build/android-signing"
    signing.mkdir(parents=True, exist_ok=True)
    credentials = signing / "signing.json"
    keystore = signing / "release.jks"
    if credentials.is_file():
        config = json.loads(credentials.read_text(encoding="utf-8"))
    else:
        config = {"password": secrets.token_urlsafe(40)}
        credentials.write_text(json.dumps(config), encoding="utf-8")
    env.update(WB_ANDROID_KEYSTORE=str(keystore), WB_ANDROID_STORE_PASSWORD=config["password"],
               WB_ANDROID_KEY_PASSWORD=config["password"])
    if not keystore.is_file():
        keytool = str(Path(env["JAVA_HOME"]) / "bin/keytool") if env.get("JAVA_HOME") else "keytool"
        subprocess.run([keytool, "-genkeypair", "-keystore", str(keystore), "-storetype", "JKS",
                        "-storepass:env", "WB_ANDROID_STORE_PASSWORD", "-keypass:env", "WB_ANDROID_KEY_PASSWORD",
                        "-alias", "workbuddy2api", "-keyalg", "RSA", "-keysize", "3072",
                        "-validity", "10000", "-dname", "CN=MiraiHub Android"], env=env, check=True)
    tasks = ["assembleRelease", "lintRelease"]
    if args.with_debug:
        tasks.append("assembleDebug")
    subprocess.run([gradle, "--no-daemon", *tasks], cwd=ROOT / "android", env=env, check=True)
    version = json.loads((ROOT / "desktop/version.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / "dist/android"
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"miraihub-{version}-android-arm64.apk"
    shutil.copy2(ROOT / "android/app/build/outputs/apk/release/app-release.apk", target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(".apk.sha256").write_text(f"{digest}  {target.name}\n", encoding="ascii")
    print(f"Built {target.name} ({target.stat().st_size / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
