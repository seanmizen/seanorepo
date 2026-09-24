import { toolRunsLocally } from './local';
import { type Faq, MAX_UPLOAD_MB, type Tool } from './tools';

// Questions that every page answers, after the page's own questions.
export function faqsFor(tool: Tool): Faq[] {
  return [
    ...tool.faqs,
    {
      q: 'Is it free?',
      a: 'Yes. You do not need an account, and we add no watermark.',
    },
    toolRunsLocally(tool)
      ? {
          q: 'What happens to my file?',
          a: 'On a computer, this page converts your video right in your browser. Your file never leaves your device, and nothing is uploaded. The first time, your browser downloads the converter (about 10 MB) and then keeps it. On a phone, your file goes to our server, which deletes it and the result after one hour. We do not share your files.',
        }
      : {
          q: 'What happens to my file?',
          a: 'Your file goes to our server, and the server converts it. The server deletes your file and the result after one hour. We do not share your files.',
        },
    {
      q: 'How large can the file be?',
      a: `Up to ${MAX_UPLOAD_MB / 1024} GB. A large video takes longer to upload and to convert.`,
    },
  ];
}
