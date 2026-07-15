import { BadRequestException } from '@nestjs/common';

type PlaywrightModule = typeof import('playwright');

export class PdfRendererService {
  async renderA4Pdf(html: string) {
    const playwright = await this.loadPlaywright();
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      if (!pdf.byteLength) {
        throw new BadRequestException('Le PDF genere est vide.');
      }
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private async loadPlaywright(): Promise<PlaywrightModule> {
    try {
      return await import('playwright');
    } catch {
      throw new BadRequestException('Playwright/Chromium n est pas installe sur le backend.');
    }
  }
}
