"""把 sample-art/raw 的 10 张原图裁成 16:9、压成 640×360 JPEG，并生成内嵌 data URL 的 TS 模块。
用法：python3 scripts/.build-sample-frames.py
顺序固定为镜 1–10（原图文件名带生成时间，不能按文件名排序）。
"""
from PIL import Image
import base64, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'sample-art', 'raw')
OUT = os.path.join(ROOT, 'sample-art', 'frames')
TS = os.path.join(ROOT, 'src', 'domain', 'sampleFrames.ts')

ORDER = [
    '07-49-23',  # 1 磨豆机
    '07-49-36',  # 2 称粉
    '07-49-47',  # 3 吧台全景
    '07-50-00',  # 4 注水蒸汽
    '07-52-00',  # 5 注视萃取（重画版）
    '07-50-34',  # 6 滴滤
    '07-50-45',  # 7 窗边
    '07-50-58',  # 8 端杯
    '07-51-11',  # 9 杯沿贴唇
    '07-51-22',  # 10 眼神
]

raw = {}
for name in os.listdir(RAW):
    if name.endswith('.png'):
        raw[name[-12:-4]] = os.path.join(RAW, name)

os.makedirs(OUT, exist_ok=True)
lines = []
total = 0
for index, key in enumerate(ORDER, 1):
    source = raw[key]
    image = Image.open(source).convert('RGB')
    width, height = image.size
    # 顶部对齐裁 16:9：原图底部有模型自动角标，裁掉 160px 正好去掉
    image = image.crop((0, 0, width, round(width * 9 / 16))).resize((640, 360), Image.LANCZOS)
    path = os.path.join(OUT, f'{index:02d}.jpg')
    image.save(path, 'JPEG', quality=78, optimize=True, progressive=True)
    total += os.path.getsize(path)
    encoded = base64.b64encode(open(path, 'rb').read()).decode()
    lines.append(f"  'data:image/jpeg;base64,{encoded}',")

header = """/**
 * 示例项目「一杯手冲的时间」的 10 张分镜画面（镜 1–10）。
 *
 * 生成方式：python3 scripts/.build-sample-frames.py
 * 原图为 1536×1024 暖色手绘插画，顶部对齐裁成 16:9（同时去掉模型角标），
 * 压成 640×360 JPEG(q78) 后内嵌为 data URL。
 * 导出 .shotflow / PDF / Excel 时由 portableProject 自动抽离为 assets/*.jpg。
 */
export const SAMPLE_FRAMES: readonly string[] = [
"""
open(TS, 'w').write(header + '\n'.join(lines) + '\n];\n')
print(f'WROTE {TS} ({os.path.getsize(TS)/1024:.0f}KB), images {total/1024:.0f}KB')
