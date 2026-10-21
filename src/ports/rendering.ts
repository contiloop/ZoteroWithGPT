export interface UntrustedRenderInput {
  content: string;
  source: "paper" | "annotation" | "note";
  requestedFormat: "plain_text" | "sanitized_html";
}

export interface SafeRenderedContent {
  content: string;
  format: "plain_text" | "sanitized_html";
  untrusted: true;
}

/** Renders display content without executing instructions, scripts, or links. */
export interface UntrustedContentRenderingPort {
  render(input: UntrustedRenderInput): Promise<SafeRenderedContent>;
}
