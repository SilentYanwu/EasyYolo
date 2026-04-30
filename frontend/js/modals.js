/**
 * 通用消息弹窗 —— 替换所有原生 alert
 * @param {string} msg 消息内容
 * @param {'info'|'warning'|'success'} type 类型: info=蓝 warning=橙 success=绿
 * @param {Function} [onOk] 点击确定后的回调
 */
export function showMessage(msg, type = 'info', onOk) {
    const modal = document.getElementById('messageModal');
    modal.className = 'modal hidden';
    modal.classList.add(type);

    const icons = { success: '✅', warning: '⚠️', info: 'ℹ️' };
    const titles = { success: '成功', warning: '警告', info: '提示' };
    document.getElementById('messageModalTitle').textContent = `${icons[type]} ${titles[type]}`;
    document.getElementById('messageModalText').textContent = msg;

    const cancelBtn = document.getElementById('messageModalCancelBtn');
    const noBtn = document.getElementById('messageModalNoBtn');
    const confirmBtn = document.getElementById('messageModalConfirmBtn');
    cancelBtn.style.display = 'none';
    noBtn.style.display = 'none';
    confirmBtn.textContent = '确定';
    confirmBtn.onclick = () => { modal.classList.add('hidden'); if (onOk) onOk(); };

    modal.classList.remove('hidden');
}

/**
 * 通用确认弹窗 —— 替换原生 confirm
 * @param {string} msg 消息内容
 * @param {'info'|'warning'|'success'} type
 * @param {Function} onConfirm 确认回调
 * @param {Function} [onCancel] 取消回调
 */
export function showConfirm(msg, type = 'warning', onConfirm, onCancel) {
    const modal = document.getElementById('messageModal');
    modal.className = 'modal hidden';
    modal.classList.add(type);

    const icons = { success: '✅', warning: '⚠️', info: 'ℹ️' };
    document.getElementById('messageModalTitle').textContent = `${icons[type]} 确认`;
    document.getElementById('messageModalText').textContent = msg;

    const cancelBtn = document.getElementById('messageModalCancelBtn');
    const noBtn = document.getElementById('messageModalNoBtn');
    const confirmBtn = document.getElementById('messageModalConfirmBtn');
    cancelBtn.style.display = '';
    noBtn.style.display = 'none';
    confirmBtn.textContent = '确定';
    confirmBtn.onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    cancelBtn.onclick = () => { modal.classList.add('hidden'); if (onCancel) onCancel(); };

    modal.classList.remove('hidden');
}

/**
 * 三选确认弹窗 —— 是 / 否 / 取消
 */
export function showThreeChoice(msg, type, confirmText, onConfirm, noText, onNo, cancelText, onCancel) {
    const modal = document.getElementById('messageModal');
    modal.className = 'modal hidden';
    modal.classList.add(type);

    const icons = { success: '✅', warning: '⚠️', info: 'ℹ️' };
    document.getElementById('messageModalTitle').textContent = `${icons[type]} 确认`;
    document.getElementById('messageModalText').textContent = msg;

    const cancelBtn = document.getElementById('messageModalCancelBtn');
    const noBtn = document.getElementById('messageModalNoBtn');
    const confirmBtn = document.getElementById('messageModalConfirmBtn');
    cancelBtn.style.display = '';
    noBtn.style.display = '';
    cancelBtn.textContent = cancelText;
    noBtn.textContent = noText;
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    noBtn.onclick = () => { modal.classList.add('hidden'); onNo(); };
    cancelBtn.onclick = () => { modal.classList.add('hidden'); if (onCancel) onCancel(); };

    modal.classList.remove('hidden');
}
