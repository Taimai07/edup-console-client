function template({about}){return [
 {label:'文件',submenu:[{role:'close',label:'关闭窗口'},{type:'separator'},{role:'quit',label:'退出'}]},
 {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
 {label:'查看',submenu:[{role:'reload',label:'重新加载页面'},{type:'separator'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
 {label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放窗口'}]},
 {label:'帮助',submenu:[{label:'关于运营工作台',click:about}]}
 ];}
module.exports={template};
