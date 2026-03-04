import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const idlPath = path.join(process.cwd(), 'sprmfun-anchor/target/idl/sprmfun_anchor.json')
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'))
  return NextResponse.json(idl)
}
