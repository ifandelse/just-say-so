// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// The site reads its reference pages and the rules from the repository at
// build time (scripts/sync.mjs), so the source of truth stays in docs/ and
// rules/manifest.json. Handwritten pages live under src/content/docs.
export default defineConfig({
  site: 'https://just-say-so.com',
  integrations: [
    starlight({
      title: 'just-say-so',
      description: 'A Claude Code plugin that lints what the agent writes and says with Vale, keeps judgment rules in its context, and turns the replies you reject into advice on your own setup.',
      logo: {
        light: './src/assets/lockup.svg',
        dark: './src/assets/lockup-dark.svg',
        replacesTitle: true
      },
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://just-say-so.com/og-image.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } }
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ifandelse/just-say-so' }],
      editLink: { baseUrl: 'https://github.com/ifandelse/just-say-so/edit/main/site/' },
      sidebar: [
        {
          label: 'Start here',
          items: [{ label: 'What is just-say-so', link: '/' }]
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }]
        }
      ],
      plugins: [starlightLinksValidator()],
      customCss: ['./src/styles/custom.css']
    })
  ]
});
