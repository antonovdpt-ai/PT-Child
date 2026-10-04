import { notoSansRegularBytes } from "./font-data.ts";
// No external assets: the font is bundled with the deployed function.
const initial = [['complaint','Жалоба'],['strengths','Сильные стороны'],['observations','Наблюдения'],['goals','Цели'],['progress','Прогресс'],['recommendations','Рекомендации']];
const session = [['what_did','Что делали'],['what_worked','Что получилось'],['attention','На что обратить внимание'],['home_recommendations','Рекомендации для дома']];
export async function renderParentPublicationPdf(snapshot: Record<string, any>): Promise<Uint8Array> {
  if (snapshot.schema_version !== 1 || !['initial','session'].includes(snapshot.report_kind) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || JSON.stringify(snapshot).length > 200000) throw new Error('Invalid snapshot');
  const deno = (globalThis as any).Deno;
  const { PDFDocument, rgb } = await (deno ? import('npm:pdf-lib@1.17.1') : import('pdf-lib'));
  const fontkit = await (deno ? import('npm:@pdf-lib/fontkit@1.1.1') : import('@pdf-lib/fontkit'));
  const url = new URL('./fonts/NotoSans-Regular.ttf', import.meta.url);
  const fontBytes = deno ? notoSansRegularBytes() : await (await import('node:fs/promises')).readFile(url);
  const document = await PDFDocument.create(); document.registerFontkit(fontkit.default);
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle('Отчёт для родителей'); document.setSubject(`Revision ${snapshot.revision}`);
  let page: any; let y = 0; let pages = 0;
  const addPage = () => { if (++pages > 100) throw new Error('PDF page limit'); page = document.addPage([595.28,841.89]); y = 790; };
  const line = (text: string, size: number) => {
    if (!page || y < 55) addPage();
    page.drawText(text, { x: 48, y, size, font, color: rgb(0.1,0.15,0.2) }); y -= size * 1.5;
  };
  const widths = new Map<string,number>();
  const started = Date.now();
  const text = (value: unknown, size = 11) => {
    for (const paragraph of String(value ?? '').replace(/\r\n?/g,'\n').split('\n')) {
      const chars = Array.from(paragraph.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\t/g,'    '));
      if (!chars.length) { line('',size); continue; }
      let offset = 0;
      while (offset < chars.length) {
        if (Date.now()-started > 20000) throw new Error('PDF render time limit');
        let end = offset; let width = 0;
        while (end < chars.length) {
          const char = chars[end];
          if (!widths.has(char)) widths.set(char,font.widthOfTextAtSize(char,1));
          const next = width + widths.get(char)! * size;
          if (end > offset && next > 499) break;
          width = next; end++;
        }
        // Confirm the actual shaped line width before drawing it.
        while (end > offset+1 && font.widthOfTextAtSize(chars.slice(offset,end).join(''),size)>499) end--;
        line(chars.slice(offset,end).join(''),size); offset = end;
      }
    }
  };
  text(snapshot.report_kind === 'initial' ? 'Первичный отчёт' : 'Отчёт о занятии',18);
  text(snapshot.child_name,14); text(`Дата: ${snapshot.source_date ?? ''} • Редакция: ${snapshot.revision}`); y -= 12;
  for (const [key,heading] of snapshot.report_kind === 'initial' ? initial : session) {
    text(heading,13); text(snapshot[key]); y -= 12;
  }
  text('Специалист',13);
  for (const key of ['therapist_name','therapist_profession','therapist_organization','therapist_phone']) if(snapshot[key]) text(snapshot[key]);
  const bytes = await document.save({useObjectStreams:false});
  if(bytes.length>10*1024*1024) throw new Error('PDF byte limit'); return bytes;
}
