#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import os

# 创建640x480的背景图片
width, height = 640, 480
bg_color = (240, 240, 240)  # 浅灰色背景

# 创建图片
img = Image.new('RGB', (width, height), bg_color)
draw = ImageDraw.Draw(img)

# 添加简单的指导文字
try:
    # 尝试使用系统字体
    font = ImageFont.truetype('/System/Library/Fonts/Arial.ttf', 18)
except:
    # 使用默认字体
    font = ImageFont.load_default()

text = "Drag TalkTunnel to Applications folder"
text_bbox = draw.textbbox((0, 0), text, font=font)
text_width = text_bbox[2] - text_bbox[0]
text_height = text_bbox[3] - text_bbox[1]

# 居中放置文字
text_x = (width - text_width) // 2
text_y = height - 60

draw.text((text_x, text_y), text, fill=(100, 100, 100), font=font)

# 保存图片
img.save('build/background.png')
print("DMG background image created: build/background.png") 