import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
export const reportOpenSource = source.slice(source.indexOf("box\n  .querySelectorAll('[data-open-parent-report]')"), source.indexOf("box\n  .querySelectorAll('[data-delete-parent-report]')"));
export const reportPdfMountSource = source.slice(source.indexOf('function mountOverviewPdfExport('), source.indexOf("\nif (state.tab === 'overview')", source.indexOf('function mountOverviewPdfExport(')));
export const reportOpenHtml = '<section id="parentReportEditor" style="display:none"><input id="reportTherapistName">' + ['Complaint','Strengths','Observations','Goals','Progress','Recommendations'].map(k => `<textarea id="report${k}"></textarea>`).join('') + '<button id="editParentReportBtn">Редактировать</button><button id="saveParentReportPdfBtn">Сохранить</button><button id="generateParentReportBtn">ИИ</button><div id="parentReportPdfExport"></div></section><button data-open-parent-report="report">Открыть</button><button data-pdf-parent-report="report">Текст и PDF</button>';

