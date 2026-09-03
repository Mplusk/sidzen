import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Загрузка пользовательских моделей отключена" }, { status: 410 });
}
