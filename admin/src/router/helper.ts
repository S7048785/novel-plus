import { Icon } from '@iconify/vue'
import { omit, isString, pickBy } from 'es-toolkit'
import { isEmpty } from 'es-toolkit/compat'
import { h } from 'vue'
import { RouterLink } from 'vue-router'

import type { MenuMixedOptions, MenuOption } from './interface'
import type { UserRole } from '@/api'
import type { MenuProps } from 'naive-ui'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 按身份裁剪菜单树。
 *
 * 规则：
 * - 菜单项 meta.roles 有值 → 当前身份交集非空才保留；无值 → 任何后台身份都能看。
 * - 分组（有 children 的父项）在子项全被裁掉时一并去掉，避免留下一个点开是空的目录。
 * - 无 children 的叶子项不会被「顺带裁掉」，因为它自己就是目标页面。
 *
 * 这层只是「界面上不该出现的东西不出现」，真正的拦截在后端（@Roles + 守卫），
 * 藏起菜单不等于有权限——所以在路由守卫里还做了一次 meta.roles 校验。
 */
export function filterMenuByRoles(options: MenuMixedOptions[], roles: UserRole[]): MenuMixedOptions[] {
  return options.flatMap((item) => {
    if (item.type === 'divider') return [item]

    // group 类型没有 meta，取不到就当作「不限制身份」
    const meta = (item as MenuOption).meta
    const allowedRoles = meta?.roles
    const allowed = !allowedRoles?.length || allowedRoles.some((role) => roles.includes(role))
    if (!allowed) return []

    const children = (item as MenuOption).children
    if (!Array.isArray(children) || isEmpty(children)) return [item]

    const keptChildren = filterMenuByRoles(children, roles)
    if (isEmpty(keptChildren)) return []

    return [{ ...item, children: keptChildren } as MenuMixedOptions]
  })
}

export function resolveMenu(
  options: MenuMixedOptions[],
  parentDisabled = false,
): NonNullable<MenuProps['options']> {
  const menuOptions: NonNullable<MenuProps['options']> = []

  options.forEach((item) => {
    if (!item.type || item.type === 'group') {
      const { children, name, path, label, icon, key, disabled, extra, props, show, type } =
        item as MenuOption

      const mergedDisabled = parentDisabled || disabled

      const renderIcon = isString(icon)
        ? icon.includes(':')
          ? () => h(Icon, { icon })
          : () => h('span', { class: `${icon}` })
        : null

      const menu = pickBy(
        {
          key: key || name || path,
          icon: renderIcon,
          label,
          disabled: mergedDisabled,
          extra,
          props,
          show,
          type,
          name,
        },
        (v) => v !== undefined,
      ) as NonNullable<MenuProps['options']>[number]

      if (Array.isArray(children) && !isEmpty(children)) {
        menu.children = resolveMenu(children, mergedDisabled)
      } else {
        menu.label = mergedDisabled
          ? label
          : () => h(RouterLink, { to: { name } }, { default: () => label })
      }

      menuOptions.push(menu)
    } else {
      menuOptions.push(item)
    }
  })

  return menuOptions
}

export function resolveRoute(options: MenuMixedOptions[]) {
  /**
   * 路由组件有两个来源：
   * - `views/**`：每个路由一个目录一个 index.vue（薄入口）；
   * - `features/<模块>/pages/**`：模块自己的页面（如章节管理），其余组件不参与路由。
   * 把 features 也纳入扫描，是为了让「模块代码集中在 features」与「views 只留入口」同时成立。
   */
  const modules = import.meta.glob(['@/views/**/*.vue', '@/features/**/pages/**/*.vue'])

  function buildRoutes(items: MenuMixedOptions[]): RouteRecordRaw[] {
    return items.flatMap((item) => {
      if (item.type === 'divider') {
        return []
      }

      if (item.type === 'group') {
        return Array.isArray(item.children) && !isEmpty(item.children)
          ? buildRoutes(item.children)
          : []
      }

      const { label, icon, meta, component, children, disabled, ...rest } = item as MenuOption

      if (disabled) {
        return []
      }

      let componentModule: RouteRecordRaw['component'] | null = null

      if (!isEmpty(component) && isString(component)) {
        const extractName = component.replace(/^\/|\.vue$/g, '')
        /**
         * 先找 views 下的入口，再落到 features/<模块>/pages/ 里。
         * menu 里统一写 `book/ChapterManage`，不用关心文件实际在哪个目录。
         */
        const [scope, ...rest] = extractName.split('/')
        const modulePath = [
          `/src/views/${extractName}.vue`,
          `/src/features/${scope}/pages/${rest.join('/')}.vue`,
        ].find((path) => modules[path])

        if (modulePath) {
          componentModule = modules[modulePath]
        }
      }

      const routeSource = {
        ...rest,
        label,
        icon,
        disabled,
        ...(componentModule ? { component: componentModule } : {}),
        meta: {
          ...meta,
          title: meta?.title || label,
          icon,
        },
      }

      const route = omit(routeSource, [
        'type',
        'label',
        'icon',
        'disabled',
        'extra',
        'props',
        'show',
        'key',
      ]) as RouteRecordRaw

      if (Array.isArray(children) && !isEmpty(children)) {
        route.children = buildRoutes(children)
      }

      return [route]
    })
  }

  return buildRoutes(options)
}
