import * as fs from 'fs';
import { BadRequestException, InternalServerErrorException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

type PlaywrightModule = typeof import('playwright');

export class PdfRendererService {
  async getRuntimeInfo() {
    const playwright = await this.loadPlaywright();
    const executablePath = playwright.chromium.executablePath();
    return {
      executablePath,
      executableExists: fs.existsSync(executablePath),
    };
  }

  async renderA4Pdf(html: string) {
    if (!html.trim()) {
      throw new UnprocessableEntityException({
        code: 'PDF_TEMPLATE_INVALID',
        message: 'Rendered HTML is empty',
      });
    }
    if (!/^<!doctype html>/i.test(html.trim())) {
      throw new UnprocessableEntityException({
        code: 'PDF_TEMPLATE_INVALID',
        message: 'Rendered HTML is missing <!DOCTYPE html>',
      });
    }
    const playwright = await this.loadPlaywright();
    const executablePath = playwright.chromium.executablePath();
    if (!fs.existsSync(executablePath)) {
      throw new ServiceUnavailableException({
        code: 'PDF_CHROMIUM_NOT_AVAILABLE',
        message: 'Chromium executable not found for Playwright',
      });
    }
    let browser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | undefined;
    try {
      browser = await playwright.chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      if (!pdf.byteLength) {
        throw new UnprocessableEntityException({
          code: 'PDF_RENDER_FAILED',
          message: 'Generated PDF is empty',
        });
      }
      const buffer = Buffer.from(pdf);
      if (buffer.byteLength < 10 * 1024) {
        throw new UnprocessableEntityException({
          code: 'PDF_RENDER_FAILED',
          message: 'Generated PDF is unexpectedly small',
        });
      }
      if (buffer.subarray(0, 4).toString() !== '%PDF') {
        throw new UnprocessableEntityException({
          code: 'PDF_RENDER_FAILED',
          message: 'Generated output is not a valid PDF',
        });
      }
      return buffer;
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException || error instanceof UnprocessableEntityException) {
        throw error;
      }
      if (String(error?.message ?? '').toLowerCase().includes('timeout')) {
        const timeoutError = new ServiceUnavailableException({
          code: 'PDF_RENDER_FAILED',
          message: 'PDF generation timed out',
        });
        (timeoutError as any).cause = error;
        throw timeoutError;
      }
      const renderError = new InternalServerErrorException({
        code: 'PDF_RENDER_FAILED',
        message: error?.message || 'PDF generation failed',
      });
      (renderError as any).cause = error;
      throw renderError;
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  private async loadPlaywright(): Promise<PlaywrightModule> {
    try {
      return await import('playwright');
    } catch {
      throw new ServiceUnavailableException({
        code: 'PDF_CHROMIUM_NOT_AVAILABLE',
        message: 'Playwright is not installed on the backend',
      });
    }
  }
}
