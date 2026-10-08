import { notoSansRegularBytes } from './font-data.ts';
import { fiziraLogoBytes } from './parent-pdf-brand.ts';

// Fonts and the exact approved brand asset are bundled. No external asset fetches.
const initial = [['complaint','С чем обратились'],['strengths','Что ребёнок сейчас умеет'],['observations','На что мы обратили внимание'],['goals','Над чем будем работать'],['progress','Динамика'],['recommendations','Рекомендации домой']];
const session = [['what_did','Что делали'],['what_worked','Что получилось'],['attention','На что обратить внимание'],['home_recommendations','Рекомендации для дома']];
const sanitize = (value: unknown) => String(value ?? '').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\t/g,'    ');

export async function renderParentPublicationPdf(snapshot: Record<string, any>): Promise<Uint8Array> {
  if (snapshot.schema_version !== 1 || !['initial','session'].includes(snapshot.report_kind) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || JSON.stringify(snapshot).length > 200000) throw new Error('Invalid snapshot');
  const deno = (globalThis as any).Deno;
  const { PDFDocument, rgb } = await (deno ? import('npm:pdf-lib@1.17.1') : import('pdf-lib'));
  const fontkit = await (deno ? import('npm:@pdf-lib/fontkit@1.1.1') : import('@pdf-lib/fontkit'));
  const url = new URL('./fonts/NotoSans-Regular.ttf', import.meta.url);
  const fontBytes = deno ? notoSansRegularBytes() : await (await import('node:fs/promises')).readFile(url);
  const document = await PDFDocument.create(); document.registerFontkit(fontkit.default);
  // Subsetting crashes the existing self-hosted Edge Runtime; preserve its working setting.
  const font = await document.embedFont(fontBytes, { subset: false });
  const logo = await document.embedPng(fiziraLogoBytes());
  const title = snapshot.report_kind === 'initial' ? 'Первичный отчёт' : 'Отчёт о занятии';
  document.setTitle(`Fizira · ${title}`); document.setSubject(`Revision ${snapshot.revision}`); document.setCreator('Fizira');
  const brand = rgb(0.025,0.43,0.45), ink = rgb(0.12,0.19,0.23), muted = rgb(0.38,0.46,0.48), rule = rgb(0.82,0.88,0.88);
  const left = 48, right = 547.28, width = right-left;
  let page: any, y = 0, count = 0, currentHeading = '';
  const started = Date.now(), widths = new Map<string,number>();
  const draw = (value: string, x: number, baseline: number, size: number, color = ink) => page.drawText(value, {x, y:baseline, size, font, color});
  const addPage = () => {
    if (++count > 100) throw new Error('PDF page limit');
    page = document.addPage([595.28,841.89]);
    const logoWidth = count === 1 ? 108 : 78, logoHeight = logoWidth * logo.height / logo.width;
    page.drawImage(logo, {x:left, y:792-logoHeight, width:logoWidth, height:logoHeight});
    if (count === 1) { draw(title,left,718,23); y = 681; }
    else { draw(title+' · Продолжение',left,728,13,brand); y = 698; }
    const ruleY = count === 1 ? 700 : 715;
    page.drawLine({start:{x:left,y:ruleY},end:{x:right,y:ruleY},thickness:1.3,color:brand});
    if (count > 1 && currentHeading) { draw(currentHeading+' (продолжение)',left,y,10,muted); y -= 23; }
  };
  const ensure = (height: number) => { if (!page || y-height < 87) addPage(); };
  const line = (value: string, size: number, color = ink) => { const leading=size*1.5; ensure(leading); draw(value,left,y,size,color); y-=leading; };
  const wrap = (value: unknown, size: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of sanitize(value).split('\n')) {
      const chars = Array.from(paragraph);
      if (!chars.length) { lines.push(''); continue; }
      let offset = 0;
      while (offset < chars.length) {
        if (Date.now()-started > 20000) throw new Error('PDF render time limit');
        let end=offset, measured=0;
        while (end<chars.length) {
          const char=chars[end]; if (!widths.has(char)) widths.set(char,font.widthOfTextAtSize(char,1));
          const next=measured+widths.get(char)!*size;
          if (end>offset && next>width) break;
          measured=next; end++;
        }
        while (end>offset+1 && font.widthOfTextAtSize(chars.slice(offset,end).join(''),size)>width) end--;
        if (end<chars.length) {
          let space=end-1; while(space>offset && !/\s/.test(chars[space])) space--;
          if (space>offset) end=space+1;
        }
        lines.push(chars.slice(offset,end).join('').trimEnd()); offset=end;
        while (offset<chars.length && chars[offset]===' ') offset++;
      }
    }
    return lines;
  };
  const text = (value: unknown, size = 11.5, color = ink) => { for (const valueLine of wrap(value,size)) line(valueLine,size,color); };
  addPage();
  text(snapshot.child_name || 'Ребёнок',15);
  const sourceDate = sanitize(snapshot.source_date).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
  if (sourceDate) text(`Дата отчёта: ${sourceDate}`,10,muted);
  y -= 22;
  for (const [key,heading] of snapshot.report_kind === 'initial' ? initial : session) {
    const value=sanitize(snapshot[key]).trim(); if (!value) continue;
    // A heading always stays with at least the first two lines of its section.
    currentHeading=''; ensure(66); currentHeading=heading;
    text(heading,12.5,brand); y-=5; text(value); y-=18;
  }
  const specialist = ['therapist_name','therapist_profession','therapist_organization','therapist_phone'].map(key => sanitize(snapshot[key]).trim()).filter(Boolean);
  if (specialist.length) {
    currentHeading=''; ensure(66); currentHeading='Специалист';
    page.drawLine({start:{x:left,y:y+4},end:{x:right,y:y+4},thickness:.7,color:rule});
    y-=15; text('Специалист',10,muted); for (const value of specialist) text(value,10.5);
  }
  const pages=document.getPages();
  pages.forEach((item,index) => {
    page=item;
    page.drawLine({start:{x:left,y:56},end:{x:right,y:56},thickness:.7,color:rule});
    draw(`Сформировано в Fizira · Редакция ${snapshot.revision}`,left,39,8,muted);
    const number=`${index+1} / ${pages.length}`;
    draw(number,right-font.widthOfTextAtSize(number,8),39,8,muted);
  });
  const bytes=await document.save({useObjectStreams:false});
  if (bytes.length>10*1024*1024) throw new Error('PDF byte limit');
  return bytes;
}
