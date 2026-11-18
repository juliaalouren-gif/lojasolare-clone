// Carrinho lateral (painel suspenso) — abre por cima da página do produto
// ao clicar em "COMPRAR AGORA" e, dali, segue para o checkout.
// Uso: window.openCartDrawer(params) com os mesmos parâmetros que já iam
// direto para o checkout (qty, price, oldPrice, light, product).
//
// IMPORTANTE (segurança de pagamento): este arquivo é 100% apresentação.
// Ele não calcula nem valida preço nenhum — só decide se o usuário marcou
// o adicional e repassa isso pro checkout.html via ?bumps=luminaria, que é
// o MESMO bump que já existe e já é validado no servidor
// (api/process-payment.js BUMP_PRICES_SERVER). Nenhum bump novo é criado.
(function () {
    // Mesma config de BUMP_CONFIG do checkout.html — precisa ficar idêntica,
    // pois é só o espelho visual do que o checkout vai cobrar.
    var BUMP_BY_PRODUCT = {
        led: { name: 'Leve +3 Luminárias LED', desc: 'Leve mais 3 unidades com desconto exclusivo', price: 59.90 },
    };
    var DEFAULT_BUMP = { name: 'Leve +2 Luminárias Solares', desc: 'Leve mais 2 unidades com desconto exclusivo', price: 49.90 };

    var PRODUCT_INFO = {
        solar:      { name: 'Luminária Solar Solare' },
        promoupse:  { name: 'Luminária Solar Solare' },
        led:        { name: 'Luminária LED Sem Fio Solare', img: 'https://lojaskazamestra.com.br/cdn/shop/files/luminariaLedPilhasPrincipal05_800x.jpg' },
        'lampada-led': { name: 'Lâmpada LED Solar Max', img: 'https://userelux.com.br/cdn/shop/files/Disenosintitulo_15_1024x.png?v=1773090670' },
        jardim:     { name: 'Luminária Solar Externa de Jardim' },
    };

    function getBump(productType) {
        return BUMP_BY_PRODUCT[productType] || DEFAULT_BUMP;
    }

    function productImg(productType, light) {
        var info = PRODUCT_INFO[productType] || PRODUCT_INFO.solar;
        if (info.img) return info.img;
        if (productType === 'jardim') return light === 'warm' ? 'jardim-principal.jpg' : 'jardim-frente.jpg';
        return light === 'white' ? 'luminaria-white.jpg' : 'luminaria-warm.jpg';
    }

    function productName(productType) {
        return (PRODUCT_INFO[productType] || PRODUCT_INFO.solar).name;
    }

    function fmt(n) { return 'R$ ' + n.toFixed(2).replace('.', ','); }

    var CSS = `
    #sc-cart-overlay {
        position: fixed; inset: 0; background: rgba(10, 20, 17, .55);
        opacity: 0; visibility: hidden; transition: opacity .3s, visibility .3s; z-index: 100000;
    }
    #sc-cart-overlay.open { opacity: 1; visibility: visible; }
    #sc-cart {
        position: fixed; top: 5vh; right: 0; width: 90vw; height: 90vh;
        background: #f0f2f5; border-radius: 18px 0 0 18px;
        box-shadow: -12px 0 40px rgba(0,0,0,.25);
        transform: translateX(105%); transition: transform .35s cubic-bezier(.22,.8,.3,1);
        z-index: 100001; display: flex; flex-direction: column; overflow: hidden;
        font-family: 'Inter', sans-serif; color: #1a1a1a;
    }
    #sc-cart.open { transform: translateX(0); }
    #sc-cart * { box-sizing: border-box; }
    #sc-cart .sc-head {
        background: #2c4c3b; color: #fff; padding: 14px 18px;
        display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    #sc-cart .sc-head h2 { font-size: 17px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; color: #fff; }
    #sc-cart .sc-close {
        background: rgba(255,255,255,.12); border: none; color: #fff; width: 36px; height: 36px;
        border-radius: 50%; font-size: 22px; line-height: 1; cursor: pointer;
    }
    #sc-cart .sc-close:hover { background: rgba(255,255,255,.22); }
    #sc-cart .sc-body { flex: 1; overflow-y: auto; padding: 16px; }
    #sc-cart .sc-inner { max-width: 620px; margin: 0 auto; }
    #sc-cart .sc-foot { flex-shrink: 0; background: #fff; border-top: 1px solid #e2e8f0; padding: 14px 16px 16px; }
    #sc-cart .sc-card { background: #fff; border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06); padding: 16px; margin-bottom: 14px; }
    #sc-cart .sc-title { font-size: 15px; font-weight: 700; color: #2c4c3b; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }

    #sc-cart .sc-item { display: flex; gap: 14px; align-items: center; }
    #sc-cart .sc-item img { width: 72px; height: 72px; object-fit: cover; border-radius: 10px; border: 1px solid #e2e8f0; flex-shrink: 0; }
    #sc-cart .sc-item-info { flex: 1; min-width: 0; }
    #sc-cart .sc-item-name { font-size: 14px; font-weight: 700; line-height: 1.3; }
    #sc-cart .sc-item-variant { font-size: 12px; color: #6b7280; margin-top: 3px; }
    #sc-cart .sc-item-price { text-align: right; flex-shrink: 0; }
    #sc-cart .sc-old { font-size: 12px; color: #6b7280; text-decoration: line-through; }
    #sc-cart .sc-now { font-size: 16px; font-weight: 800; color: #2c4c3b; }

    #sc-cart .sc-offer {
        display: flex; gap: 12px; align-items: center; border: 2px dashed #cbd5e1; border-radius: 12px;
        padding: 12px; cursor: pointer; transition: border-color .2s, background .2s; user-select: none;
    }
    #sc-cart .sc-offer:hover { border-color: #4CAF50; }
    #sc-cart .sc-offer.selected { border-style: solid; border-color: #4CAF50; background: #f0faf0; }
    #sc-cart .sc-check {
        width: 22px; height: 22px; border-radius: 6px; border: 2px solid #cbd5e1; background: #fff;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; font-size: 13px; font-weight: 900;
    }
    #sc-cart .sc-offer.selected .sc-check { background: #4CAF50; border-color: #4CAF50; }
    #sc-cart .sc-offer-img { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex-shrink: 0; border: 1px solid #e2e8f0; }
    #sc-cart .sc-offer-body { flex: 1; min-width: 0; }
    #sc-cart .sc-badge { display: inline-block; white-space: nowrap; background: #fbbf24; color: #1a1a1a; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 4px; margin-bottom: 4px; letter-spacing: .3px; }
    #sc-cart .sc-offer-name { font-size: 14px; font-weight: 700; line-height: 1.3; }
    #sc-cart .sc-offer-desc { font-size: 12px; color: #6b7280; margin-top: 2px; }
    #sc-cart .sc-offer-price { font-size: 15px; font-weight: 800; color: #388E3C; white-space: nowrap; flex-shrink: 0; }

    #sc-cart .sc-rows { display: flex; flex-direction: column; gap: 6px; font-size: 14px; max-width: 620px; margin: 0 auto; }
    #sc-cart .sc-row { display: flex; justify-content: space-between; }
    #sc-cart .sc-muted { color: #6b7280; }
    #sc-cart .sc-row.sc-total { font-size: 18px; font-weight: 800; color: #2c4c3b; padding-top: 0; border-top: none; margin-top: 0; }
    #sc-cart .sc-pix { color: #388E3C; font-weight: 600; font-size: 13px; }
    #sc-cart .sc-promo {
        display: flex; align-items: center; gap: 10px; background: #fff7e0; border: 1px solid #fcd34d;
        color: #78350f; border-radius: 8px; padding: 6px 10px; font-size: 12px; line-height: 1.3; margin-bottom: 8px; gap: 6px;
    }
    #sc-cart .sc-promo strong { color: #2c4c3b; }
    #sc-cart .sc-promo.on { background: #f0faf0; border-color: #86efac; color: #166534; }
    #sc-cart .sc-promo-icon { font-size: 14px; flex-shrink: 0; }
    #sc-cart .sc-buy {
        display: block; width: 100%; max-width: 620px; margin: 12px auto 0; border: none; cursor: pointer;
        background: #2c4c3b; color: #fff; font-family: inherit; font-size: 17px; font-weight: 800; letter-spacing: .5px;
        padding: 16px; border-radius: 12px; box-shadow: 0 6px 18px rgba(44,76,59,.25); transition: background .2s;
    }
    #sc-cart .sc-buy:hover { background: #24524a; }
    #sc-cart .sc-free { font-size: 12px; font-weight: 600; color: #388E3C; }
    #sc-cart .sc-foot { padding: 10px 16px 12px; }
    #sc-cart .sc-secure { text-align: center; font-size: 12px; color: #6b7280; margin-top: 8px; }

    @media (max-width: 480px) {
        #sc-cart .sc-body { padding: 12px; }
        #sc-cart .sc-offer {
            display: grid; grid-template-columns: 22px 46px minmax(0, 1fr);
            column-gap: 10px; row-gap: 4px; padding: 10px;
        }
        #sc-cart .sc-offer .sc-check, #sc-cart .sc-offer .sc-offer-img { grid-row: span 2; }
        #sc-cart .sc-offer-img { width: 46px; height: 46px; }
        #sc-cart .sc-offer-price { grid-column: 3; font-size: 15px; }
        #sc-cart .sc-rows { gap: 4px; font-size: 13px; }
        #sc-cart .sc-row.sc-total { font-size: 17px; }
        #sc-cart .sc-buy { padding: 13px; margin-top: 8px; }
        #sc-cart .sc-secure { margin-top: 5px; font-size: 11px; }
        #sc-cart .sc-item img { width: 60px; height: 60px; }
    }`;

    var HTML = `
    <div id="sc-cart-overlay"></div>
    <aside id="sc-cart" role="dialog" aria-modal="true" aria-labelledby="sc-heading" aria-hidden="true">
        <div class="sc-head">
            <h2 id="sc-heading"><i class="fas fa-shopping-cart"></i> Seu carrinho</h2>
            <button class="sc-close" type="button" aria-label="Fechar carrinho">&times;</button>
        </div>
        <div class="sc-body">
            <div class="sc-inner">
                <section class="sc-card">
                    <div class="sc-item">
                        <img id="sc-item-img" src="" alt="">
                        <div class="sc-item-info">
                            <div class="sc-item-name" id="sc-item-name"></div>
                            <div class="sc-item-variant" id="sc-item-variant"></div>
                        </div>
                        <div class="sc-item-price">
                            <div class="sc-old" id="sc-old"></div>
                            <div class="sc-now" id="sc-now"></div>
                        </div>
                    </div>
                </section>
                <section class="sc-card">
                    <h3 class="sc-title"><i class="fas fa-gift"></i> Aproveite e adicione ao pedido</h3>
                    <div class="sc-promo" id="sc-promo">
                        <span class="sc-promo-icon" id="sc-promo-icon">🎁</span>
                        <span id="sc-promo-text"></span>
                    </div>
                    <div class="sc-offer" id="sc-offer">
                        <div class="sc-check">✓</div>
                        <img class="sc-offer-img" id="sc-offer-img" src="" alt="">
                        <div class="sc-offer-body">
                            <span class="sc-badge">MAIS VENDIDO</span>
                            <div class="sc-offer-name" id="sc-offer-name"></div>
                            <div class="sc-offer-desc" id="sc-offer-desc"></div>
                        </div>
                        <div class="sc-offer-price" id="sc-offer-price"></div>
                    </div>
                </section>
            </div>
        </div>
        <div class="sc-foot">
            <div class="sc-rows">
                <div class="sc-row sc-total"><span>Total <small class="sc-free">· Frete grátis</small></span><span id="sc-total"></span></div>
                <div class="sc-row sc-pix"><span>⚡ No Pix com 5% OFF</span><span id="sc-pix"></span></div>
            </div>
            <button class="sc-buy" type="button">COMPRAR AGORA</button>
            <p class="sc-secure">🔒 Pagamento 100% seguro</p>
        </div>
    </aside>`;

    var state = null;
    var built = false;

    function $(id) { return document.getElementById(id); }

    function build() {
        if (built) return;
        built = true;
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        var wrap = document.createElement('div');
        wrap.innerHTML = HTML;
        while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);

        $('sc-cart-overlay').addEventListener('click', close);
        document.querySelector('#sc-cart .sc-close').addEventListener('click', close);
        document.querySelector('#sc-cart .sc-buy').addEventListener('click', goToCheckout);
        $('sc-offer').addEventListener('click', function () {
            state.selected = !state.selected;
            render();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && $('sc-cart').classList.contains('open')) close();
        });
    }

    function render() {
        var bump = state.bump;
        var extras = state.selected ? bump.price : 0;
        $('sc-offer').classList.toggle('selected', state.selected);
        $('sc-total').textContent = fmt(state.price + extras);
        // Mesma fórmula do checkout.html (updateTotalDisplay): 5% sobre o
        // kit no Pix, adicional pelo valor cheio — sem Math.round extra, pra
        // não divergir do valor que o checkout vai mostrar e cobrar.
        $('sc-pix').textContent = fmt(state.price * 0.95 + extras);
        $('sc-promo').classList.toggle('on', state.selected);
        $('sc-promo-icon').textContent = state.selected ? '✅' : '🎁';
        $('sc-promo-text').innerHTML = state.selected
            ? '<span><strong>Liberado:</strong> 5% OFF no Pix + Frete grátis HOJE</span>'
            : '<span>' + bump.desc.replace('Leve mais', 'Leve mais') + ' por ' + fmt(bump.price) + ' e ganhe <strong>5% OFF no Pix</strong> + <strong>Frete grátis HOJE</strong></span>';
    }

    function goToCheckout() {
        var params = new URLSearchParams(state.params);
        // "luminaria" é o MESMO bump que já existe no checkout.html e já é
        // validado em api/process-payment.js — nenhum bump novo é criado aqui.
        if (state.selected) params.set('bumps', 'luminaria');
        window.location.href = 'checkout.html?' + params.toString();
    }

    function close() {
        $('sc-cart').classList.remove('open');
        $('sc-cart').setAttribute('aria-hidden', 'true');
        $('sc-cart-overlay').classList.remove('open');
        document.body.style.overflow = '';
        if (typeof window.liveStage === 'function') window.liveStage();
    }

    window.openCartDrawer = function (params) {
        build();
        params = new URLSearchParams(params);
        var light = params.get('light') || 'warm';
        var qty = parseInt(params.get('qty') || '2', 10);
        var price = parseFloat(params.get('price') || '0');
        var oldPrice = parseFloat(params.get('oldPrice') || '0');
        var product = params.get('product') || 'solar';
        var bump = getBump(product);
        var name = productName(product);
        var img = productImg(product, light);

        // Reabrir o carrinho mantém o adicional já marcado
        state = { params: params.toString(), price: price, bump: bump, selected: state ? state.selected : false };

        $('sc-item-img').src = img;
        $('sc-item-img').alt = name;
        $('sc-item-name').textContent = name;
        $('sc-offer-img').src = img;
        $('sc-offer-img').alt = bump.name;
        $('sc-offer-name').textContent = bump.name;
        $('sc-offer-desc').textContent = bump.desc;
        $('sc-offer-price').textContent = '+ ' + fmt(bump.price);
        $('sc-item-variant').textContent = qty + ' unidades — ' + (light === 'white' ? 'Luz Branca (Fria)' : 'Luz Quente (Amarela)');
        $('sc-now').textContent = fmt(price);
        $('sc-old').textContent = oldPrice > price ? fmt(oldPrice) : '';
        render();

        void $('sc-cart').offsetWidth;
        $('sc-cart').classList.add('open');
        $('sc-cart').setAttribute('aria-hidden', 'false');
        $('sc-cart-overlay').classList.add('open');
        document.body.style.overflow = 'hidden';
        document.querySelector('#sc-cart .sc-close').focus();
        if (typeof window.liveStage === 'function') window.liveStage('carrinho');
    };
})();
