/**
 * 全局应用状态管理
 */
export const state = {
    currentModelName: "",
    currentCategory: "",
    activeMenuId: null, // 当前展开的上下文菜单ID
    
    // 侧边栏状态：从本地存储读取
    get isSidebarCollapsed() {
        return localStorage.getItem('sidebarCollapsed') === 'true';
    },
    set isSidebarCollapsed(value) {
        localStorage.setItem('sidebarCollapsed', value);
    }
};
