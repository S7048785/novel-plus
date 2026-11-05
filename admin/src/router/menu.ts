import type { MenuMixedOptions } from '@/router/interface'

/**
 * 静态菜单：后端（server）不返回菜单数据，菜单在前端写死。
 *
 * meta.roles 决定哪些身份能看到该项（不写 = 任何能进后台的身份都能看）。
 * 后台只允许管理员登录，所以这里的 roles 目前只是「将来作家端上线」的提前量：
 * 现在 书籍管理 与 用户管理 都标了 admin（后台只允许管理员登录，标与不标结果一样，
 * 但显式标出来以后接作家端时不会漏）。
 *
 * 注意这只是界面收口，后端每个 controller 上都有对应的 @Roles，藏菜单不等于有权限。
 */
export const menu: MenuMixedOptions[] = [
  {
    path: 'dashboard',
    name: 'dashboard',
    icon: 'mage:dashboard-chart-arrow',
    label: '仪表板',
    meta: {
      componentName: 'Dashboard',
      pinned: true,
    },
    component: 'dashboard/index',
  },
  {
    path: 'data-show',
    name: 'dataShow',
    label: '数据展示',
    icon: 'fluent:data-area-32-regular',
    redirect: 'data-show/data-table',
    children: [
      {
        path: 'data-table',
        name: 'dataTable',
        icon: 'ph:table',
        label: '数据表格',
        meta: {
          componentName: 'DataTable',
          title: '数据表格',
        },
        component: 'data-show/data-table/index',
      },
      {
        path: 'data-form',
        name: 'dataForm',
        icon: 'ph:article',
        label: '数据表单',
        meta: {
          componentName: 'DataForm',
          title: '数据表单',
        },
        component: 'data-show/data-form/index',
      },
    ],
  },
  {
    path: 'book',
    name: 'bookList',
    icon: 'ph:books',
    label: '书籍管理',
    meta: {
      componentName: 'BookList',
      title: '书籍管理',
      roles: ['admin'],
    },
    component: 'book/index',
  },
  {
    /**
     * 章节管理：路径带 bookId，只能从书籍列表的「章节」按钮进入，所以不进侧边栏。
     * 但路由必须注册（show 只影响菜单渲染，resolveRoute 仍会建路由）：
     * 否则手输 URL 落到 404，而不是「有权限但没入口」。
     */
    path: 'book/:bookId/chapter',
    name: 'bookChapter',
    icon: 'ph:list-numbers',
    label: '章节管理',
    show: false,
    meta: {
      componentName: 'BookChapter',
      title: '章节管理',
      roles: ['admin'],
    },
    component: 'book/ChapterManage',
  },
  {
    path: 'user',
    name: 'userList',
    icon: 'ph:users',
    label: '用户管理',
    meta: {
      componentName: 'UserList',
      title: '用户管理',
      roles: ['admin'],
    },
    component: 'user/index',
  },
  {
    path: 'about',
    name: 'about',
    icon: 'ph:info',
    label: '关于项目',
    component: 'about/index',
  },
]
