const {validateAIRequest}=require('../shared/ai-contract.cjs');

function registerBusinessIpc({ipcMain, checkSender, request, isInstalling}) {
  ipcMain.handle('edup:request', async (event, route, body) => {
    checkSender(event);
    if (isInstalling() && body !== undefined) throw Error('UPDATE_INSTALLING');
    const supported = ['snapshot', 'health', 'drafts', 'diagnostics'].includes(route);
    if (!supported || (route === 'drafts') !== (body !== undefined)) throw Error('IPC_ROUTE_INVALID');
    return request(route, body);
  });
  ipcMain.handle('edup:ai', async (event, op, args) => {
    checkSender(event);
    if (isInstalling()) throw Error('UPDATE_INSTALLING');
    return request('ai', validateAIRequest(op, args));
  });
}

module.exports={registerBusinessIpc};
