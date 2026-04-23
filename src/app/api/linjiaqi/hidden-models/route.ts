import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const HIDDEN_MODELS_PATH = path.join(process.cwd(), 'hidden-models.json');

function readHiddenModels(): string[] {
  try {
    if (fs.existsSync(HIDDEN_MODELS_PATH)) {
      const data = JSON.parse(fs.readFileSync(HIDDEN_MODELS_PATH, 'utf-8'));
      return data.hidden || [];
    }
  } catch (e) {
    // ignore
  }
  return [];
}

function writeHiddenModels(hidden: string[]) {
  fs.writeFileSync(HIDDEN_MODELS_PATH, JSON.stringify({ hidden }, null, 2), 'utf-8');
}

export async function GET() {
  const hidden = readHiddenModels();
  return NextResponse.json({ success: true, hidden });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id, is_visible } = body;

    if (!model_id) {
      return NextResponse.json({ error: '缺少 model_id' }, { status: 400 });
    }

    const hidden = readHiddenModels();

    if (is_visible === false) {
      // 隐藏模型
      if (!hidden.includes(model_id)) {
        hidden.push(model_id);
      }
    } else {
      // 展示模型
      const index = hidden.indexOf(model_id);
      if (index > -1) {
        hidden.splice(index, 1);
      }
    }

    writeHiddenModels(hidden);
    return NextResponse.json({ success: true, hidden });
  } catch (error) {
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
