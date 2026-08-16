import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { execSync } from 'child_process';

export const runtime = 'nodejs';
export const maxDuration = 60;

function resolveBaseUrl(): string {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return `http://localhost:${process.env.PORT || 3000}`;
}

async function launchBrowser() {
    try {
        chromium.setGraphicsMode = false;

        const browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: true,
        });
        console.log('Using @sparticuz/chromium');
        return browser;
    } catch (chromiumError) {
        console.error(
            '@sparticuz/chromium failed, falling back to system Chrome:',
            chromiumError instanceof Error ? chromiumError.stack : chromiumError
        );
    }

    let executablePath: string | undefined;

    if (process.platform === 'win32') {
        const possiblePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
            `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Chromium\\Application\\chrome.exe`,
            'C:\\Program Files\\Chromium\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
        ];

        for (const path of possiblePaths) {
            try {
                execSync(`if exist "${path}" echo found`, { encoding: 'utf8', shell: 'cmd' });
                executablePath = path;
                break;
            } catch {
                // try next path
            }
        }
    } else {
        try {
            executablePath = execSync(
                'which google-chrome-stable || which google-chrome || which chromium || which chromium-browser || which chrome',
                { encoding: 'utf8' }
            ).trim();
        } catch {
            const possiblePaths = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/usr/bin/google-chrome',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
            ];

            for (const path of possiblePaths) {
                try {
                    execSync(`test -f "${path}"`, { encoding: 'utf8' });
                    executablePath = path;
                    break;
                } catch {
                    // try next path
                }
            }
        }
    }

    if (!executablePath) {
        throw new Error('Chrome executable not found. Please install Google Chrome or Chromium.');
    }

    const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
        ],
    });
    console.log('Using system Chrome at:', executablePath);
    return browser;
}

/**
 * PDF 생성 API 엔드포인트
 * Puppeteer-core + @sparticuz/chromium를 사용하여 현재 이력서 페이지를 PDF로 변환
 */
export async function POST(_request: NextRequest) {
    console.log('PDF generation started');

    try {
        const browser = await launchBrowser();
        const page = await browser.newPage();
        const targetUrl = `${resolveBaseUrl()}/`;

        console.log('Navigating to:', targetUrl);
        await page.goto(targetUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
        });
        console.log('Page loaded successfully');

        await page.evaluate(() => {
            document.body.classList.add('pdf-mode');

            const container = document.querySelector('.container') as HTMLElement;
            if (container) {
                container.classList.add('pdf-mobile-layout');
                container.style.cssText = 'column-count: 2; column-gap: 3rem; column-fill: auto;';
            }

            const personalHeader = document.querySelector(
                '[style*="display: flex"][style*="justify-content: space-between"]'
            ) as HTMLElement;
            if (personalHeader) {
                personalHeader.classList.add('personal-info-header');
            }

            document.querySelectorAll('.pdf-download-button, .pdf-link-button').forEach((button) => {
                (button as HTMLElement).style.display = 'none';
            });

            const pdfButtonSection = document.querySelector('.center-section') as HTMLElement;
            if (pdfButtonSection) {
                const sectionText = pdfButtonSection.querySelector('p');
                if (sectionText?.textContent?.includes('PDF 버전으로 이력서를 다운로드하세요')) {
                    pdfButtonSection.style.display = 'none';
                }
            }
        });

        console.log('Generating PDF...');
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '2cm',
                bottom: '2cm',
                left: '1cm',
                right: '1cm',
            },
            displayHeaderFooter: false,
        });
        console.log('PDF generated successfully, size:', pdf.length, 'bytes');

        await browser.close();

        return new Response(Buffer.from(pdf), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="resume.pdf"',
            },
        });
    } catch (error) {
        console.error('PDF generation failed:', error);

        return NextResponse.json(
            {
                error: 'PDF generation failed',
                message: error instanceof Error ? error.message : 'Unknown error',
                details:
                    process.env.NODE_ENV === 'development' && error instanceof Error
                        ? error.stack
                        : undefined,
            },
            { status: 500 }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
