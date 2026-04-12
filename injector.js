(function () {
  if (document.getElementById('applyiq-floating-btn')) return;

  const btn = document.createElement('div');
  btn.id = 'applyiq-floating-btn';
  btn.title = "Open ApplyIQ";
  btn.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background-color: #131318;
    box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(108, 99, 255, 0.5);
    z-index: 2147483647;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
  `;

  const imgUrl = chrome.runtime.getURL('icons/applyiq_icon.png');
  btn.innerHTML = `<img src="${imgUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:contain;">`;

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.1)';
    btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6), 0 0 15px rgba(0, 232, 122, 0.6)';
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(108, 99, 255, 0.5)';
  });

  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openSidePanel' });
  });

  document.body.appendChild(btn);
})();
