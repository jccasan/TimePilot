// invoice.render.ts
// =================
// Lightweight mustache-style template renderer.
// Supports:
//   {{path.to.value}}                - value substitution
//   {{#items}}...{{/items}}          - array iteration
//   {{#optional.path}}...{{/optional.path}} - conditional block (render if truthy)
//
// Usage:
//   import { renderInvoice } from './invoice.render';
//   const html = renderInvoice(templateHtml, themeJson, computedInvoiceData);
//
// To change theme: edit server/templates/invoice.theme.json
// To change layout: edit server/templates/invoice.default.html

import fs from "fs";
import path from "path";

function resolve(obj: any, keyPath: string): any {
  if (!keyPath || !obj) return undefined;
  return keyPath.split(".").reduce((o: any, k: string) => (o != null ? o[k] : undefined), obj);
}

function substituteValues(html: string, data: any): string {
  return html.replace(/\{\{([^#/][^}]*)\}\}/g, (_match, key) => {
    const val = resolve(data, key.trim());
    if (val === undefined || val === null) return "";
    return String(val);
  });
}

function processBlocks(html: string, data: any): string {
  const blockRegex = /\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  let prev = "";
  let safety = 0;
  while (prev !== html && safety < 50) {
    prev = html;
    safety++;
    html = html.replace(blockRegex, (_match, key, inner) => {
      const val = resolve(data, key);

      if (Array.isArray(val)) {
        return val
          .map((item) => {
            let rendered = processBlocks(inner, { ...data, ...item });
            rendered = substituteValues(rendered, { ...data, ...item });
            return rendered;
          })
          .join("");
      }

      if (val && typeof val === "object") {
        let rendered = processBlocks(inner, data);
        rendered = substituteValues(rendered, data);
        return rendered;
      }

      if (val) {
        let rendered = processBlocks(inner, data);
        rendered = substituteValues(rendered, data);
        return rendered;
      }

      return "";
    });
  }

  return html;
}

function renderTemplate(template: string, data: any): string {
  let html = template;
  html = processBlocks(html, data);
  html = substituteValues(html, data);
  return html;
}

export function loadTemplate(templatePath: string): string {
  return fs.readFileSync(templatePath, "utf-8");
}

export function loadTheme(themePath: string): any {
  return JSON.parse(fs.readFileSync(themePath, "utf-8"));
}

export function renderInvoice(templateHtml: string, theme: any, invoiceData: any): string {
  const mergedData = {
    theme,
    ...invoiceData,
  };
  return renderTemplate(templateHtml, mergedData);
}

const TEMPLATES_DIR = path.join(process.cwd(), "server", "templates");

export function getDefaultTemplatePath(): string {
  return path.join(TEMPLATES_DIR, "invoice.default.html");
}

export function getDefaultThemePath(): string {
  return path.join(TEMPLATES_DIR, "invoice.theme.json");
}
