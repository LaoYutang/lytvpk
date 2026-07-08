import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'LytVPK',
  description: 'Left 4 Dead 2 VPK Mod 管理器使用文档',
  cleanUrls: true,
  appearance: 'force-dark',
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#07142f' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/logo.png' }]
  ],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: '快速开始', link: '/guide/quick-start' },
      { text: '功能说明', link: '/features/mod-management' },
      { text: '工具箱', link: '/toolbox/' },
      { text: '常见问题', link: '/operations/troubleshooting' },
      { text: '立即下载', link: 'https://github.com/LaoYutang/lytvpk/releases' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '项目介绍', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '安装与运行', link: '/guide/install' }
        ]
      },
      {
        text: '功能说明',
        items: [
          { text: 'MOD 管理', link: '/features/mod-management' },
          { text: '导入与拖拽', link: '/features/import-drag-drop' },
          { text: '创意工坊浏览', link: '/features/workshop' },
          { text: '下载与解析', link: '/features/downloads' },
          { text: '收藏服务器', link: '/features/servers' },
          { text: '设置', link: '/features/settings' },
          { text: '关于与更新', link: '/features/about-update' }
        ]
      },
      {
        text: '工具箱',
        items: [
          { text: '工具箱总览', link: '/toolbox/' },
          { text: '问题 Mod 查找', link: '/toolbox/problem-mod-scan' },
          { text: 'Mod 冲突检测', link: '/toolbox/conflict-check' },
          { text: '模型面数检测', link: '/toolbox/model-stats' },
          { text: 'VPK 解包', link: '/toolbox/vpk-unpack' },
          { text: 'VPK 打包', link: '/toolbox/vpk-pack' },
          { text: '崩溃转储查看器', link: '/toolbox/mdmp-report' },
          { text: '喷漆制作', link: '/toolbox/spray-tool' }
        ]
      },
      {
        text: '排查与开发',
        items: [
          { text: '常见问题', link: '/operations/troubleshooting' },
          { text: '文档站构建', link: '/development/build' }
        ]
      }
    ],
    outline: {
      label: '本页目录',
      level: [2, 3]
    },
    docFooter: {
      prev: '上一页',
      next: '下一页'
    },
    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清空搜索',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/LaoYutang/lytvpk' }
    ]
  }
});
