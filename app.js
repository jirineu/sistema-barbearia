const app = {
    dados: {
        caixa: 0, 
        agenda: [], 
        historico: [], 
        prestadores: [], 
        estoque: [], 
        servicos: [],
        logsAcertos: [], // Novo: Armazena o histórico de edições de saldo
        config: { inicioDia: 8, fimDia: 19, intervalo: 30 }
    },

    

persistir() {
    // 1. Salva sempre no LocalStorage para garantir rapidez e funcionamento offline
    localStorage.setItem('barber_local_db', JSON.stringify(this.dados));

    // 2. Cancela qualquer agendamento de salvamento pendente (debounce)
    if (this.timerSalvar) clearTimeout(this.timerSalvar);

    // 3. Agenda o envio para o GitHub após 2 segundos de inatividade
    this.timerSalvar = setTimeout(async () => {
        if (githubDB.creds) {
            console.log("☁️ Tentando sincronizar com GitHub...");
            const sucesso = await githubDB.salvar(this.dados);
            if (sucesso) {
                console.log("✅ Sincronizado com sucesso!");
            } else {
                console.warn("⚠️ Falha na sincronização. Tentará novamente na próxima alteração.");
            }
        }
    }, 500);
},
    renderView(view, btn) {
        if (view === 'add-agenda') {
            this.prepararNovoAgendamento();
            return;
        }

        document.querySelectorAll('.view-section').forEach(s => s.style.display = 'none');
        const targetView = (view === 'externo') ? 'add-agenda' : view;
        
        const viewEl = document.getElementById(`view-${targetView}`);
        if(viewEl) viewEl.style.display = 'block';

        const tabBar = document.querySelector('.tab-bar');
        // Esconde tab bar no histórico ou no externo
        tabBar.style.display = (view === 'externo' || view === 'historico') ? 'none' : 'flex';
        
        if (btn) {
            document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        this.atualizarDadosTela(targetView);
    },

    atualizarDadosTela(view) {
    if (view === 'dash') this.atualizarDashPorPeriodo('mes'); // Corretoif (view === 'dash') this.renderDash();
    if (view === 'agenda') this.filtrarLista('agenda', '');
    if (view === 'historico') this.filtrarHistorico();
    
    // Estas duas linhas dependem da filtrarLista estar correta:
    if (view === 'servicos') this.filtrarLista('servicos', '');
    if (view === 'estoque') this.filtrarLista('estoque', '');
    
    if (view === 'prestadores') this.renderListaPrestadores();
},

atualizarDashPorPeriodo(periodo) {
    if (!this.dados.historico) this.dados.historico = [];

    const agora = new Date();
    const hojeString = agora.toISOString().split('T')[0];
    let inicio = new Date();
    inicio.setHours(0, 0, 0, 0);

    // Ajuste dos filtros de data
    if (periodo === 'dia') {
        inicio = new Date(hojeString + 'T00:00:00');
    } else if (periodo === 'semana') {
        inicio.setDate(agora.getDate() - 7);
    } else if (periodo === 'mes') {
        inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
    } else if (periodo === 'ano') {
        inicio = new Date(agora.getFullYear(), 0, 1);
    } else if (periodo === 'tudo') {
        inicio = new Date(0); 
    }

    const filtrados = this.dados.historico.filter(h => {
        const dataHString = h.dataConclusao || h.data;
        if (!dataHString) return false;

        if (periodo === 'dia') return dataHString === hojeString;
        if (periodo === 'tudo') return true;

        const dataH = new Date(dataHString + 'T12:00:00');
        return dataH >= inicio;
    });

    // --- NOVA LÓGICA DE CÁLCULO POR PAGAMENTO ---
    const resumoPg = { pix: 0, dinheiro: 0, credito: 0, debito: 0 };
    
    filtrados.forEach(item => {
        // Só contabiliza se for serviço (ignora ajustes se houver)
        const isServico = item.cliente !== "AJUSTE MANUAL" && item.cliente !== "PAGAMENTO REALIZADO";
        if (isServico && item.pagamento && resumoPg.hasOwnProperty(item.pagamento)) {
            resumoPg[item.pagamento] += parseFloat(item.valorBruto || item.valor || 0);
        }
    });

    // Atualiza os labels do painel expandível se eles existirem na tela
    if (document.getElementById('resumo-pix')) {
        document.getElementById('resumo-pix').innerText = `R$ ${resumoPg.pix.toFixed(2)}`;
        document.getElementById('resumo-dinheiro').innerText = `R$ ${resumoPg.dinheiro.toFixed(2)}`;
        document.getElementById('resumo-credito').innerText = `R$ ${resumoPg.credito.toFixed(2)}`;
        document.getElementById('resumo-debito').innerText = `R$ ${resumoPg.debito.toFixed(2)}`;
    }
    // --------------------------------------------

    // Cálculos Financeiros Originais
    const bruto = filtrados.reduce((acc, curr) => acc + (parseFloat(curr.valorBruto || curr.valor || 0)), 0);
    const liquido = filtrados.reduce((acc, curr) => acc + (parseFloat(curr.valorLiquido || 0)), 0);

    // Renderiza a interface enviando o período para os labels
    this.atualizarInterfaceDash(periodo, bruto, liquido, filtrados);
},

toggleResumoPagamento() {
        const painel = document.getElementById('dash-pagamentos-resumo');
        const seta = document.getElementById('seta-resumo');
        
        if (painel.style.display === 'none') {
            painel.style.display = 'block';
            seta.innerText = '▲';
        } else {
            painel.style.display = 'none';
            seta.innerText = '▼';
        }
    }, // <-- Certifique-se de que há uma VÍRGULA aqui se houver outra função depois
// Função auxiliar para evitar repetição de código
atualizarInterfaceDash(texto, bruto, liquido, listaFiltrada) {
    const elBruto = document.getElementById('dash-bruto');
    const elLiquido = document.getElementById('dash-liquido');
    const elTxt = document.getElementById('dash-periodo-txt');
    const elTotalCortes = document.getElementById('dash-cortes-total');
    const elMelhorPres = document.getElementById('dash-barbeiro-top');
    const elClientePeriodo = document.getElementById('dash-cliente-top');
    const elClienteGeral = document.getElementById('dash-cliente-permanente');

    // 1. Contadores apenas para o período selecionado
    const contagemPeriodo = { prestadores: {}, clientes: {} };
    let totalCortesReais = 0;

    listaFiltrada.forEach(item => {
        const cliente = item.cliente || "";
        const profissional = item.prestador || item.barbeiro;
        const valor = parseFloat(item.valorBruto || item.valor || 0);

        // Considera apenas serviços reais (ignora ajustes/pagamentos)
        if (valor > 0 && !cliente.toUpperCase().includes("AJUSTE")) {
            totalCortesReais++;
            if (profissional) contagemPeriodo.prestadores[profissional] = (contagemPeriodo.prestadores[profissional] || 0) + 1;
            if (cliente) contagemPeriodo.clientes[cliente] = (contagemPeriodo.clientes[cliente] || 0) + 1;
        }
    });

    // 2. Ranking Permanente (Varre TODO o histórico do sistema)
    const contagemGeral = {};
    this.dados.historico.forEach(item => {
        const cli = item.cliente || "";
        if (cli && !cli.toUpperCase().includes("AJUSTE")) {
            contagemGeral[cli] = (contagemGeral[cli] || 0) + 1;
        }
    });

    const getMelhor = (obj) => {
        const entries = Object.entries(obj);
        return entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : "-";
    };

    // 3. Atualiza os textos na tela
    if (elBruto) elBruto.innerText = `R$ ${bruto.toFixed(2)}`;
    if (elLiquido) elLiquido.innerText = `R$ ${liquido.toFixed(2)}`;
    if (elTxt) elTxt.innerText = texto === 'Tudo' ? 'Total' : texto;
    if (elTotalCortes) elTotalCortes.innerText = totalCortesReais;
    
    // Melhores do Período (Mudam conforme o botão)
    if (elMelhorPres) elMelhorPres.innerText = getMelhor(contagemPeriodo.prestadores);
    if (elClientePeriodo) elClientePeriodo.innerText = getMelhor(contagemPeriodo.clientes);

    // Melhor de Sempre (Fixo)
    if (elClienteGeral) elClienteGeral.innerText = getMelhor(contagemGeral);

    // 4. Estilo dos botões (destaque o selecionado)
    document.querySelectorAll('#view-dash .btn-small').forEach(btn => {
        const tBtn = btn.innerText.toLowerCase();
        const active = (texto.toLowerCase() === 'hoje' && tBtn === 'dia') || (tBtn === texto.toLowerCase());
        btn.style.background = active ? 'var(--accent)' : '#333';
        btn.style.color = active ? 'black' : 'white';
    });
},
    // --- GESTÃO DE HISTÓRICO ---
// --- GESTÃO DE HISTÓRICO ---
   // --- GESTÃO DE HISTÓRICO E FATURAMENTO ---
    setFiltroRapido(modo) {
        const inputData = document.getElementById('filtro-data-hist');
        const inputMes = document.getElementById('filtro-mes-hist');
        if (!inputData || !inputMes) return;

        inputData.value = "";
        inputMes.value = "";

        if (modo === 'hoje') {
            inputData.value = new Date().toISOString().split('T')[0];
        } else if (modo === 'mes') {
            inputMes.value = new Date().toISOString().slice(0, 7);
        }
        
        this.filtrarHistorico();
    },

filtrarHistorico() {
    const dataFiltro = document.getElementById('filtro-data-hist').value;
    const mesFiltro = document.getElementById('filtro-mes-hist').value;
    const prestadorFiltro = document.getElementById('filtro-prestador-hist')?.value || "";
    const container = document.getElementById('lista-historico-content');

    if (!container) return;

    let filtrados = [...(this.dados.historico || [])];

    // 1. Filtros de Data e Profissional
    if (dataFiltro) filtrados = filtrados.filter(h => h.data === dataFiltro);
    else if (mesFiltro) filtrados = filtrados.filter(h => h.data.startsWith(mesFiltro));
    if (prestadorFiltro) filtrados = filtrados.filter(h => h.prestador === prestadorFiltro);

    // 2. Cálculos do Resumo
    const faturamentoBruto = filtrados.reduce((acc, curr) => {
        const v = curr.valorBruto || curr.valor || 0; 
        return acc + (v > 0 ? v : 0);
    }, 0);

    const lucroLiquido = filtrados.reduce((acc, curr) => {
        const l = curr.valorLiquido || curr.lucroCasa || 0;
        return acc + l;
    }, 0);

    const resumoHtml = `
        <div style="background:var(--card); padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid #333;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px">
                <span style="color:#888; font-size:12px">Faturamento Bruto:</span>
                <strong style="color:var(--text); font-size:14px">R$ ${faturamentoBruto.toFixed(2)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-top:1px solid #333; padding-top:8px">
                <span style="color:#888; font-size:12px">Lucro Líquido (Caixa):</span>
                <strong style="color:var(--success); font-size:16px">R$ ${lucroLiquido.toFixed(2)}</strong>
            </div>
        </div>
    `;

    // 3. Renderização da Lista
    container.innerHTML = resumoHtml + (filtrados.reverse().map(h => {
        const vBruto = h.valorBruto || 0;
        const vLiquido = h.valorLiquido || 0;
        const vComissao = h.valorComissao || 0;
        const dataFormatada = h.data ? h.data.split('-').reverse().join('/') : '---';

        // Identificação dos tipos
        const isAjuste = h.cliente === "AJUSTE MANUAL";
        const isPagamento = h.cliente === "PAGAMENTO REALIZADO";
        const isServico = !isAjuste && !isPagamento;

        // Configuração visual dinâmica
        let labelTipo = isServico ? "✅ SERVIÇO" : (isAjuste ? "🛠️ AJUSTE" : "💰 PAGAMENTO");
        let corBorda = isServico ? "var(--success)" : (isAjuste ? "var(--accent)" : "#888");
        let corTextoValor = isServico ? "var(--success)" : (isAjuste ? "var(--accent)" : "white");
        
        // O que mostrar no valor principal (lado direito)
        let valorPrincipal = isServico ? vLiquido : vComissao;

        // --- Lógica das Pílulas de Pagamento ---
        const coresPg = { pix: '#00ced1', dinheiro: '#2ecc71', credito: '#e67e22', debito: '#9b59b6' };
        const corBadge = coresPg[h.pagamento] || '#444';
        const badgeHtml = h.pagamento ? `<span style="background:${corBadge}; color:white; font-size:8px; padding:2px 5px; border-radius:4px; margin-left:5px; text-transform:uppercase; font-weight:bold; vertical-align:middle;">${h.pagamento}</span>` : '';

        return `
            <div class="item-list" style="border-left: 4px solid ${corBorda}; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; background: #1a1a1a; padding: 12px; border-radius: 8px;">
                <div>
                    <strong style="color:${isServico ? 'var(--success)' : 'white'}; font-size:13px">${labelTipo}</strong>
                    ${badgeHtml}
                    <span style="color:#666; font-size:11px; margin-left:5px">${h.servico || ''}</span><br>
                    
                    <small style="color:#aaa">Profissional: <b>${h.prestador || '---'}</b></small><br>
                    <small style="color:#555; font-size:10px">${dataFormatada} - ${h.hora || ''} | Cliente: ${h.cliente}</small>
                </div>
                
                <div style="text-align:right">
                    <span style="color:${corTextoValor}; font-weight:bold; font-size:15px">
                        R$ ${valorPrincipal.toFixed(2)}
                    </span><br>
                    <small style="color:#444; font-size:10px">
                        ${isServico ? `Bruto: R$ ${vBruto.toFixed(2)}` : 'Movimentação'}
                    </small>
                </div>
            </div>
        `;
    }).join('') || '<p style="text-align:center; padding:20px; color:#666">Sem registros.</p>');
},

prepararNovoAgendamento() {
    const optPrestadores = this.dados.prestadores.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('');
    const optServicos = this.dados.servicos.map(s => `<option value="${s.nome}" data-preco="${s.valor}">${s.nome} - R$ ${s.valor}</option>`).join('');
    
    const optProdutos = (this.dados.estoque || []).map(p => {
        const precoItem = parseFloat(p.precoVenda || p.preco || p.valor || p.valorVenda || 0);
        const qtd = p.quantidade || p.qtd || 0;
        return `<option value="${p.nome}" data-preco="${precoItem}">${p.nome} - R$ ${precoItem.toFixed(2)} (${qtd} un)</option>`;
    }).join('');

    const hoje = new Date().toISOString().split('T')[0];
    
    // Verifica se é cliente acessando pelo link
    const params = new URLSearchParams(window.location.search);
    const ehExterno = params.has('agendar');

    const html = `
        <div class="${ehExterno ? 'agendar-mode-form' : ''}">
            <input type="text" id="ag-nome" placeholder="Nome do Cliente">
            
            <label style="font-size:12px; color:#888; display:block; margin-top:10px">Data:</label>
            <input type="date" id="ag-data" value="${hoje}">
            
            <label style="font-size:12px; color:#888; display:block; margin-top:10px">Barbeiro:</label>
            <select id="ag-prestador-select" onchange="app.atualizarHorariosDisponiveis()">
                <option value="">Selecione...</option>
                ${optPrestadores}
            </select>
            
            <label style="font-size:12px; color:#888; display:block; margin-top:10px">Serviço:</label>
            <select id="ag-servico-select" onchange="app.atualizarTotalAgendamento()">
                <option value="">Selecione o serviço...</option>
                ${optServicos}
            </select>

            <label style="font-size:12px; color:#888; display:block; margin-top:10px">Adicionar Produto (Opcional):</label>
            <select id="ag-produto-select" onchange="app.atualizarTotalAgendamento()">
                <option value="">Nenhum produto selecionado</option>
                ${optProdutos}
            </select>
            
            <label style="font-size:12px; color:#888; display:block; margin-top:10px">Horário:</label>
            <select id="ag-hora-select">
                <option value="">Escolha o profissional...</option>
            </select>

            <div id="total-preview" style="margin-top:20px; text-align:right; font-weight:bold; color:var(--success); font-size:18px; border-top:1px solid #333; padding-top:10px">
                Total: R$ 0,00
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
                <button class="btn-primary" style="background: var(--accent); color: #000; font-weight: bold;" onclick="app.salvarAgenda()">Confirmar Agendamento</button>
                
                <button class="btn-primary" style="background:#333;" 
                    onclick="${ehExterno ? "app.salvarAgenda('cancelar')" : "app.fecharModal()"}">
                    Cancelar
                </button>
            </div>
        </div>
    `;

    this.abrirModalForm(ehExterno ? "Reserva de Horário" : "Novo Agendamento", html);

    // Se for link externo, força o modal a ocupar a tela inteira
    if (ehExterno) {
        const sheet = document.querySelector('.bottom-sheet');
        if (sheet) {
            sheet.style.height = '100vh';
            sheet.style.borderRadius = '0';
        }
    }
},

    atualizarTotalAgendamento() {
    let total = 0;
    
    // 1. Pega valor do serviço selecionado
    const servSelect = document.getElementById('ag-servico-select');
    const selectedServ = servSelect.options[servSelect.selectedIndex];
    if (selectedServ && selectedServ.dataset.preco) {
        total += parseFloat(selectedServ.dataset.preco);
    }

    // 2. Pega valor do produto selecionado (Ajustado para o novo Select)
    const prodSelect = document.getElementById('ag-produto-select');
    if (prodSelect) {
        const selectedProd = prodSelect.options[prodSelect.selectedIndex];
        if (selectedProd && selectedProd.dataset.preco) {
            total += parseFloat(selectedProd.dataset.preco);
        }
    }

    // 3. Atualiza o texto na tela
    const display = document.getElementById('total-preview');
    if (display) {
        display.innerText = `Total: R$ ${total.toFixed(2)}`;
    } else {
        // Caso você não tenha o ID total-preview, podemos criar um log ou alerta
        console.log("Total calculado: R$ " + total.toFixed(2));
    }
},


   salvarAgenda(acao) {
    const params = new URLSearchParams(window.location.search);
    const ehExterno = params.has('agendar');

    // --- ALERTA DE CANCELAMENTO PARA O CLIENTE DO LINK ---
    if (ehExterno && acao === 'cancelar') {
        alert("Pode continuar o seu agendamento a qualquer momento clicando em OK. Não perca o seu horário!");
        return; 
    }

    const cliente = document.getElementById('ag-nome').value;
    const data = document.getElementById('ag-data').value;
    const prestador = document.getElementById('ag-prestador-select').value;
    const hora = document.getElementById('ag-hora-select').value;
    
    // Captura o Serviço
    const selectServ = document.getElementById('ag-servico-select');
    const servico = selectServ.value;
    const precoServico = parseFloat(selectServ.options[selectServ.selectedIndex]?.dataset.preco) || 0;

    // Captura o Produto
    const selectProd = document.getElementById('ag-produto-select');
    const produtoNome = selectProd.value;
    const precoProduto = parseFloat(selectProd.options[selectProd.selectedIndex]?.dataset.preco) || 0;

    // Cálculo do valor final
    const valorFinal = precoServico + precoProduto;

    if (cliente && data && prestador && hora && servico) {
        
        // --- NOVO: LÓGICA DE ABATIMENTO DE ESTOQUE ---
        if (produtoNome) {
            const itemEstoque = this.dados.estoque.find(p => p.nome === produtoNome);
            
            if (itemEstoque) {
                const quantidadeAtual = parseInt(itemEstoque.qtd || 0);
                
                if (quantidadeAtual > 0) {
                    itemEstoque.qtd = quantidadeAtual - 1;
                    console.log(`Estoque de ${produtoNome} atualizado para: ${itemEstoque.qtd}`);
                } else {
                    alert(`O produto "${produtoNome}" acabou de esgotar no estoque!`);
                    return; 
                }
            }
        }

        // --- SALVAR O DADO NA AGENDA ---
        this.dados.agenda.push({ 
            id: Date.now(), 
            cliente, data, prestador, hora, 
            servico: produtoNome ? `${servico} + ${produtoNome}` : servico, 
            produto: produtoNome || null,
            valorServico: precoServico,
            valorProduto: precoProduto,
            valor: valorFinal 
        });

        if (ehExterno) {
            // --- AJUSTE AQUI: SALVAMENTO FORÇADO PARA EXTERNO ---
            localStorage.setItem('barber_local_db', JSON.stringify(this.dados));
            
            console.log("Enviando agendamento para nuvem...");
            
         githubDB.salvar(this.dados).then(() => {
    // 1. Salva o link completo (que contém o token) em uma variável temporária
    const linkReagendamento = window.location.href;

    // 2. PONTO ZERO: Limpa absolutamente tudo do navegador do cliente
    localStorage.removeItem('barber_auth');
    localStorage.removeItem('barber_local_db');
    
    // Limpa os dados da memória do aplicativo
    githubDB.creds = null;
    app.dados.servicos = [];
    app.dados.prestadores = [];
    app.dados.agenda = [];

    this.fecharModal();

    // 3. EXIBE A MENSAGEM FINAL (TELA LIMPA)
    document.body.innerHTML = `
        <div style="height:100vh; background:#0f0f0f; display:flex; justify-content:center; align-items:center; font-family:sans-serif; padding:20px; color:white;">
            <div style="background:#1a1a1a; padding:40px; border-radius:20px; border:1px solid #D4AF37; text-align:center; max-width:400px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">
                
                <div style="font-size:60px; color:#D4AF37; margin-bottom:20px;">✓</div>
                
                <h2 style="color:#D4AF37; margin-bottom:10px;">Agendamento Confirmado!</h2>
                
                <p style="color:#ccc; margin-bottom:30px; line-height:1.6;">
                    Olá <strong>${cliente}</strong>, seu horário foi reservado com sucesso.<br>
                    Obrigado pela preferência!
                </p>

                <button onclick="window.location.href='${linkReagendamento}'" 
                    style="width:100%; padding:18px; background:#D4AF37; border:none; border-radius:12px; font-weight:bold; cursor:pointer; color:black; font-size:16px; transition: 0.3s; box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);">
                    Fazer outro agendamento
                </button>
                
            </div>
        </div>
    `;
});
            
            return; 
        }

        // Se for o barbeiro usando o app internamente
        this.persistir();
        this.fecharModal();
        this.renderView('agenda');
    } else {
        // Se clicar em salvar sem preencher nada no modo link, também avisa para continuar
        if (ehExterno) {
            alert("Pode continuar o seu agendamento a qualquer momento clicando em OK. Não perca o seu horário!");
        } else {
            alert("Preencha todos os campos!");
        }
    }
},
abrirCheckout(id) {
    const item = this.dados.agenda.find(a => a.id === id);
    if (!item) return;

    const valorBruto = parseFloat(item.valor) || 0;

    document.getElementById('modal-content').innerHTML = `
        <h3 style="margin-bottom:15px">Finalizar Atendimento</h3>
        <p><strong>Cliente:</strong> ${item.cliente}</p>
        <p><strong>Serviço:</strong> ${item.servico}</p>
        <p><strong>Barbeiro:</strong> ${item.prestador}</p>
        
        <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 10px; text-align: left; border: 1px solid #333;">
            <label style="color: #888; font-size: 12px; display: block; margin-bottom: 8px;">Forma de Pagamento:</label>
            <select id="checkout-pagamento" style="width: 100%; padding: 10px; border-radius: 8px; background: #000; color: white; border: 1px solid #444;">
                <option value="dinheiro">💵 Dinheiro</option>
                <option value="pix">📱 PIX</option>
                <option value="credito">💳 Crédito</option>
                <option value="debito">💳 Débito</option>
            </select>
        </div>

        <div style="margin: 15px 0; padding: 15px; background: #1a1a1a; border-radius: 10px; text-align: center; border: 1px solid #333;">
            <span style="color: #888; font-size: 14px;">Total Pago pelo Cliente:</span>
            <h2 style="color:var(--success); margin-top:5px">R$ ${valorBruto.toFixed(2)}</h2>
        </div>
        
        <button class="btn-primary" onclick="app.finalizarPagamento(${id})">Confirmar Pagamento</button>
        
        <button type="button" class="btn-primary" style="background:#b30000; margin-top:10px" onclick="app.excluirAgendamento(${id})">Excluir Agendamento</button>

        <button class="btn-primary" style="background:#333; margin-top:10px" onclick="app.fecharModal()">Voltar</button>
    `;
    document.getElementById('modal-container').style.display = 'flex';
},
excluirAgendamento(id) {
    if (confirm("Deseja realmente excluir este agendamento?")) {
        // 1. Localiza o índice
        const index = this.dados.agenda.findIndex(a => a.id === id);
        
        if (index !== -1) {
            // 2. Remove do array de dados
            this.dados.agenda.splice(index, 1);
            
            // 3. SALVA NO LOCALSTORAGE (Crucial)
            this.persistir();
            
            // 4. Fecha o modal primeiro para evitar erros de renderização
            this.fecharModal();
            
            // 5. Atualiza a tela da agenda com um pequeno delay para garantir o processamento
            setTimeout(() => {
                this.renderView('agenda');
                // Se a função filtrarLista existir, força a atualização da lista visual
                if (typeof this.filtrarLista === 'function') {
                    this.filtrarLista('agenda', '');
                }
            }, 50);
            
            console.log("Agendamento excluído e salvo com sucesso!");
        }
    }
},

finalizarPagamento(id) {
    const index = this.dados.agenda.findIndex(a => a.id === id);
    if (index === -1) return;

    // --- CAPTURA A FORMA DE PAGAMENTO DO MODAL ---
    const formaPagamento = document.getElementById('checkout-pagamento').value;

    const itemConcluido = this.dados.agenda[index];
    let custoProdutoTotal = 0;

    // --- LÓGICA DE ESTOQUE E CUSTO ---
    if (itemConcluido.produto) {
        const pEstoque = this.dados.estoque.find(p => p.nome === itemConcluido.produto);
        if (pEstoque) {
            if (pEstoque.qtd > 0) pEstoque.qtd -= 1;
            else if (pEstoque.quantidade > 0) pEstoque.quantidade -= 1;
            custoProdutoTotal = parseFloat(pEstoque.precoCusto || 0);
        }
    }

    // --- NOVA LÓGICA DE COMISSÃO DINÂMICA ---
    const funcionario = this.dados.prestadores.find(p => p.nome === itemConcluido.prestador);
    const valorBruto = parseFloat(itemConcluido.valor) || 0;
    let valorComissaoCalculada = 0;

    if (funcionario) {
        const tipo = funcionario.tipo || 'fixo';
        const valorBaseComissao = parseFloat(funcionario.comissao) || 0;

        if (tipo === 'porcentagem') {
            valorComissaoCalculada = valorBruto * (valorBaseComissao / 100);
        } else if (tipo === 'fixo') {
            valorComissaoCalculada = valorBaseComissao;
        } else if (tipo === 'dono') {
            valorComissaoCalculada = 0;
        }
    }

    // --- CÁLCULO FINANCEIRO FINAL ---
    const valorLiquido = valorBruto - valorComissaoCalculada - custoProdutoTotal;

    // Atualiza o Caixa da Casa
    if (typeof this.dados.caixa !== 'number') this.dados.caixa = 0;
    this.dados.caixa += valorLiquido;

    // Salva no Histórico com o indicador de pagamento
    if (!this.dados.historico) this.dados.historico = [];
    this.dados.historico.push({
        ...itemConcluido,
        pagamento: formaPagamento, // <--- ADICIONADO AQUI
        valorBruto: valorBruto,           
        valorComissao: valorComissaoCalculada, 
        valorCustoItem: custoProdutoTotal, 
        valorLiquido: valorLiquido,       
        dataConclusao: new Date().toISOString().split('T')[0]
    });
    
    // Finalização e Persistência
    this.dados.agenda.splice(index, 1);
    this.persistir();
    this.fecharModal();
    this.renderView('dash');

    console.log(`Venda Finalizada (${formaPagamento}): Lucro R$ ${valorLiquido.toFixed(2)}`);
},
    // --- FUNÇÕES DE APOIO (MANTIDAS) ---
filtrarLista(tipo, termo) {
    const termoBusca = termo.toLowerCase();

    // --- BLOCO DE SERVIÇOS ---
    if (tipo === 'servicos') {
        const container = document.getElementById('lista-servicos-content');
        if (!container) return;
        const filtrados = (this.dados.servicos || []).filter(s => s.nome.toLowerCase().includes(termoBusca));
        container.innerHTML = filtrados.map(s => `
            <div class="item-list" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #333;">
                <div>
                    <strong>${s.nome}</strong><br>
                    <small>R$ ${parseFloat(s.valor || 0).toFixed(2)}</small>
                </div>
                <button class="btn-small" style="background:#444; color:white" onclick="app.prepararEdicaoServico(${s.id})">Editar</button>
            </div>
        `).join('') || '<p style="text-align:center; padding:10px; color:#666">Nenhum serviço cadastrado.</p>';
    }

    // --- BLOCO DE ESTOQUE ---
   // --- BLOCO DE ESTOQUE ATUALIZADO ---
if (tipo === 'estoque') {
    const container = document.getElementById('lista-estoque-content');
    if (!container) return;
    const filtrados = (this.dados.estoque || []).filter(e => e.nome.toLowerCase().includes(termoBusca));
    
    container.innerHTML = filtrados.map(e => {
        const venda = parseFloat(e.precoVenda || e.preco || 0);
        const qtd = parseInt(e.qtd || 0);
        return `
            <div class="item-list" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #333; border-left: 4px solid ${qtd > 0 ? 'var(--success)' : 'var(--danger)'}">
                <div style="flex:1">
                    <strong style="color:white">${e.nome}</strong><br>
                    <small style="color:#888">Qtd: <b style="color:${qtd > 0 ? 'white' : 'var(--danger)'}">${qtd}</b> | Venda: R$ ${venda.toFixed(2)}</small>
                </div>
                
                <div style="display:flex; gap:8px; align-items:center">
                    <button class="btn-small" style="background:#333; color:var(--danger); font-size:18px; width:35px" 
                            onclick="app.ajustarQtdManual(${e.id}, -1)">−</button>
                    
                    <button class="btn-small" style="background:#333; color:var(--success); font-size:18px; width:35px" 
                            onclick="app.ajustarQtdManual(${e.id}, 1)">+</button>
                    
                    <button class="btn-small" style="background:#444; color:white; margin-left:5px" 
                            onclick="app.prepararEdicaoEstoque(${e.id})">✏️</button>
                </div>
            </div>
        `;
    }).join('') || '<p style="text-align:center; padding:10px; color:#666">Estoque vazio.</p>';
}
    // --- BLOCO DE AGENDA (O que estava faltando) ---
   if (tipo === 'agenda') {
        const container = document.getElementById('lista-agenda-content');
        if (!container) return;

        const filtrados = (this.dados.agenda || []).filter(a => {
            // Agora filtra apenas pelo termo de busca (nome do cliente ou prestador)
            return a.cliente.toLowerCase().includes(termoBusca) || 
                   a.prestador.toLowerCase().includes(termoBusca);
        });

        // Ordena por data e depois por hora para não ficar bagunçado
        filtrados.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));

        container.innerHTML = filtrados.map(a => `
            <div class="item-list" style="border-left: 4px solid var(--accent); margin-bottom: 8px; background: #1a1a1a; padding: 15px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="font-size:16px; color:white">${a.data.split('-').reverse().join('/')} - ${a.hora}</strong><br>
                    <span style="color:white; font-weight:bold">${a.cliente}</span><br>
                    <small style="color:var(--accent)">✂️ ${a.servico}</small>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:bold; color:var(--success); margin-bottom:5px">R$ ${parseFloat(a.valor || 0).toFixed(2)}</div>
                    <button class="btn-small" style="background:var(--success); color:black; font-weight:bold; border:none; padding:8px 12px; border-radius:5px; cursor:pointer" 
                            onclick="app.abrirCheckout(${a.id})">FINALIZAR</button>
                </div>
            </div>
        `).join('') || `<p style="text-align:center; padding:20px; color:#666">Nenhum agendamento encontrado.</p>`;
    }
},
ajustarQtdManual(id, mudanca) {
    const item = this.dados.estoque.find(e => e.id === id);
    if (item) {
        const novaQtd = (parseInt(item.qtd) || 0) + mudanca;
        
        // Impede estoque negativo
        if (novaQtd < 0) {
            alert("A quantidade não pode ser inferior a zero.");
            return;
        }

        item.qtd = novaQtd;
        this.persistir(); // Salva no LocalStorage
        
        // Atualiza apenas a lista de estoque para refletir a mudança
        this.filtrarLista('estoque', ''); 
    }
},

    abrirModalForm(titulo, html) {
        const modal = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        content.innerHTML = `<h3>${titulo}</h3><br>${html}`;
        modal.style.display = 'flex';
    },

    fecharModal() { document.getElementById('modal-container').style.display = 'none'; },

    atualizarHorariosDisponiveis() {
        const barbeiro = document.getElementById('ag-prestador-select').value;
        const data = document.getElementById('ag-data').value;
        const selectHora = document.getElementById('ag-hora-select');
        if (!barbeiro || !data) return;

        let html = '<option value="">Selecione o horário...</option>';
        const { inicioDia, fimDia, intervalo } = this.dados.config;
        for (let h = inicioDia; h < fimDia; h++) {
            for (let m = 0; m < 60; m += intervalo) {
                const horaFormatada = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                // Verifica ocupação na data e barbeiro específicos
                const ocupado = this.dados.agenda.some(a => a.prestador === barbeiro && a.hora === horaFormatada && a.data === data);
                if (!ocupado) html += `<option value="${horaFormatada}">${horaFormatada}</option>`;
            }
        }
        selectHora.innerHTML = html;
    },

// Adicione estas funções dentro do objeto app:
renderListaPrestadores() {
    const container = document.getElementById('lista-pre');
    if (!container) return;

    container.innerHTML = [...this.dados.prestadores].reverse().map(p => {
        // Lógica para definir o que exibir na descrição
        let infoRemuneracao = '';
        const tipo = p.tipo || 'fixo'; // Garante compatibilidade com cadastros antigos

        if (tipo === 'dono') {
            infoRemuneracao = '<span style="color:var(--accent); font-weight:bold">Proprietário (Lucro Total)</span>';
        } else if (tipo === 'porcentagem') {
            infoRemuneracao = `Comissão: <b>${p.comissao}%</b> por serviço`;
        } else {
            infoRemuneracao = `Comissão fixa: <b>R$ ${parseFloat(p.comissao || 0).toFixed(2)}</b>`;
        }

        return `
            <div class="item-list" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #333; border-left: 4px solid ${tipo === 'dono' ? 'var(--accent)' : '#555'}">
                <div style="flex:1">
                    <strong style="color:white; font-size:16px">${p.nome}</strong><br>
                    <small style="color:#888">${infoRemuneracao}</small>
                </div>
                <div style="display:flex; gap:8px">
                    <button class="btn-small" style="background:var(--success); color:black; font-weight:bold" onclick="app.abrirAcerto(${p.id})">Acerto</button>
                    <button class="btn-small" style="background:#333; color:white" onclick="app.prepararEdicaoPrestador(${p.id})">Editar</button>
                </div>
            </div>
        `;
    }).join('') || '<p style="text-align:center; padding:20px; color:#666">Nenhum profissional cadastrado.</p>';
},

   prepararEdicaoPrestador(id = null) {
    // Busca o prestador ou cria um objeto padrão com tipo 'porcentagem'
    const p = id ? this.dados.prestadores.find(x => x.id === id) : { nome: '', comissao: '', tipo: 'porcentagem' };
    
    const btnExcluir = id ? `<button class="btn-primary" style="background:var(--danger); color:white; margin-top:5px" onclick="app.excluirItem('prestadores', ${id})">Excluir Profissional</button>` : '';

    const html = `
        <input type="hidden" id="pre-id" value="${id || ''}">
        
        <label style="font-size:12px; color:#888">Nome:</label>
        <input type="text" id="pre-nome" class="input-field" value="${p.nome}" placeholder="Ex: João">

        <label style="font-size:12px; color:#888; margin-top:10px; display:block">Tipo de Remuneração:</label>
        <select id="pre-tipo" class="input-field" onchange="app.atualizarUIComissao()" style="width:100%; background:#222; color:white; border:1px solid #444; padding:12px; border-radius:10px; margin-bottom:10px">
            <option value="porcentagem" ${p.tipo === 'porcentagem' ? 'selected' : ''}>Porcentagem (%)</option>
            <option value="fixo" ${p.tipo === 'fixo' ? 'selected' : ''}>Valor Fixo (R$)</option>
            <option value="dono" ${p.tipo === 'dono' ? 'selected' : ''}>Dono (Sem comissão)</option>
        </select>

        <div id="div-valor-comissao" style="display: ${p.tipo === 'dono' ? 'none' : 'block'}">
            <label id="label-pre-comissao" style="font-size:12px; color:#888; margin-top:10px; display:block">
                ${p.tipo === 'fixo' ? 'Comissão (R$):' : 'Comissão (%):'}
            </label>
            <input type="number" id="pre-comissao" class="input-field" value="${p.comissao}">
        </div>
        
        <button class="btn-primary" style="margin-top:20px" onclick="app.salvarPrestador()">Salvar</button>
        ${btnExcluir}
        <button class="btn-primary" style="background:#333; margin-top:5px" onclick="app.fecharModal()">Cancelar</button>
    `;

    this.abrirModalForm(id ? "Editar Profissional" : "Novo Profissional", html);
},

// Função auxiliar para esconder/mostrar campos no modal
atualizarUIComissao() {
    const tipo = document.getElementById('pre-tipo').value;
    const divValor = document.getElementById('div-valor-comissao');
    const label = document.getElementById('label-pre-comissao');

    if (tipo === 'dono') {
        divValor.style.display = 'none';
    } else {
        divValor.style.display = 'block';
        label.innerText = tipo === 'fixo' ? 'Comissão (R$):' : 'Comissão (%):';
    }
},

   salvarPrestador() {
    const id = document.getElementById('pre-id').value;
    const nome = document.getElementById('pre-nome').value;
    const tipo = document.getElementById('pre-tipo').value; // Novo campo select
    const inputComissao = document.getElementById('pre-comissao');
    
    // Para o tipo 'dono', a comissão é sempre 0. Para os outros, pegamos o valor do input.
    const comissao = tipo === 'dono' ? 0 : parseFloat(inputComissao.value);

    // Validação: Se não for dono, a comissão deve ser um número válido
    if (!nome || (tipo !== 'dono' && isNaN(comissao))) {
        alert("Preencha o nome e o valor da comissão corretamente!");
        return;
    }

    const dadosPrestador = {
        id: id ? parseInt(id) : Date.now(),
        nome: nome,
        tipo: tipo,
        comissao: comissao
    };

    if (id) {
        // Caso de Edição: Localiza pelo ID e atualiza o objeto inteiro
        const index = this.dados.prestadores.findIndex(p => p.id == id);
        if (index !== -1) {
            this.dados.prestadores[index] = dadosPrestador;
        }
    } else {
        // Caso de Novo: Adiciona o novo objeto com o campo 'tipo'
        this.dados.prestadores.push(dadosPrestador);
    }

    this.persistir(); // Salva no LocalStorage
    this.fecharModal(); // Fecha o formulário
    this.renderView('prestadores'); // Chama a renderização da view de equipe
},
    // --- DENTRO DO OBJETO APP ---

abrirAcerto(id) {
    const p = this.dados.prestadores.find(x => x.id === id);
    
    // CÁLCULO DINÂMICO: Soma comissões e subtrai pagamentos
    const saldoAtual = this.dados.historico
        .filter(h => h.prestador === p.nome)
        .reduce((acc, curr) => {
            const valorParaSomar = curr.valorComissao || 0;
            return acc + valorParaSomar;
        }, 0);

    // Renderiza os logs (histórico visual)
    const logs = (this.dados.logsAcertos || [])
        .filter(l => l.prestadorId === id)
        .reverse()
        .map(l => {
            if (l.tipo === 'pagamento') {
                return `
                    <div style="font-size:11px; color:#888; border-bottom:1px solid #333; padding:5px 0; display:flex; justify-content:space-between">
                        <span>${l.data.split(',')[0]} (PAGO)</span>
                        <strong style="color:var(--success)">- R$ ${l.valorPago.toFixed(2)}</strong>
                    </div>`;
            } else {
                return `
                    <div style="font-size:11px; color:#888; border-bottom:1px solid #333; padding:5px 0; display:flex; justify-content:space-between">
                        <span>${l.data.split(',')[0]} (AJUSTE)</span>
                        <span>R$ ${l.antigo.toFixed(2)} ➔ R$ ${l.novo.toFixed(2)}</span>
                    </div>`;
            }
        }).join('') || '<p style="font-size:11px; color:#555">Sem movimentações.</p>';

    const html = `
        <div style="text-align:center; margin-bottom:20px; background:#151515; padding:20px; border-radius:15px; border:1px solid #333">
            <h2 style="color:var(--accent); font-size:28px">R$ ${saldoAtual.toFixed(2)}</h2>
            <small style="color:#888">Comissões acumuladas de ${p.nome}</small>
        </div>
        
        <div style="background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:20px; border:1px solid #222">
            <label style="font-size:11px; color:#888; display:block; margin-bottom:8px">Corrigir saldo atual para (R$):</label>
            <div style="display:flex; gap:8px">
                <input type="number" id="novo-saldo-acerto" placeholder="0.00" style="flex:1; margin-bottom:0; height:35px; background:#000; border:1px solid #333; color:white; border-radius:5px; padding:0 10px">
                <button onclick="app.confirmarAjusteSaldo(${id}, ${saldoAtual})" style="background:var(--accent); color:black; border:none; padding:0 15px; border-radius:5px; font-weight:bold; cursor:pointer">OK</button>
            </div>
        </div>
        <label style="font-size:12px; color:#888">Histórico de Acertos/Edições:</label>
        <div style="max-height:120px; overflow-y:auto; background:#111; padding:10px; border-radius:8px; margin-bottom:20px; border:1px solid #222">
            ${logs}
        </div>

        <button class="btn-primary" style="background:var(--success); color:black" onclick="app.zerarComissao(${id}, ${saldoAtual})">Confirmar Pagamento Total (R$)</button>
        <button class="btn-primary" style="background:#333; margin-top:10px" onclick="app.fecharModal()">Voltar</button>
    `;
    this.abrirModalForm(`Acerto: ${p.nome}`, html);
},
confirmarAjusteSaldo(id, saldoAntigo) {
    const p = this.dados.prestadores.find(x => x.id === id);
    const campoInput = document.getElementById('novo-saldo-acerto');
    const novoSaldo = parseFloat(campoInput.value);

    if (isNaN(novoSaldo)) return alert("Insira um valor válido.");
    const diferenca = novoSaldo - saldoAntigo;
    if (diferenca === 0) return alert("O valor é igual ao atual.");

    // Registro no Histórico (Afetando o Lucro Líquido da Casa)
    this.dados.historico.push({
        id: Date.now(),
        cliente: "AJUSTE MANUAL",
        prestador: p.nome, // Agora salva o nome corretamente para o filtro
        servico: diferenca > 0 ? "Aumento de Saldo" : "Desconto de Saldo",
        valorBruto: 0,
        valorLiquido: -diferenca, // Se o funcionário ganha +, a casa perde lucro líquido
        valorComissao: diferenca,
        data: new Date().toISOString().split('T')[0],
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
    });

    if (!this.dados.logsAcertos) this.dados.logsAcertos = [];
    this.dados.logsAcertos.push({
        prestadorId: id,
        tipo: 'edicao',
        data: new Date().toLocaleString('pt-BR'),
        antigo: saldoAntigo,
        novo: novoSaldo
    });

    this.persistir();
    alert(`Saldo de ${p.nome} ajustado!`);
    this.abrirAcerto(id); // Recarrega a modal
},
zerarComissao(id, valorPago) {
    if (valorPago <= 0) return alert("Não há saldo para pagar.");
    if (!confirm(`Confirmar pagamento de R$ ${valorPago.toFixed(2)}?`)) return;

    const p = this.dados.prestadores.find(x => x.id === id);

    this.dados.historico.push({
        id: Date.now(),
        cliente: "PAGAMENTO REALIZADO",
        prestador: p.nome, // Para quem foi o pagamento
        servico: "Baixa de Comissão",
        valorBruto: 0,
        valorLiquido: 0,   // Pagamento de comissão não altera lucro (já foi deduzido no serviço)
        valorComissao: -valorPago, // Zera o saldo do funcionário
        data: new Date().toISOString().split('T')[0],
        hora: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
    });

    this.dados.logsAcertos.push({
        prestadorId: id,
        tipo: 'pagamento',
        data: new Date().toLocaleString('pt-BR'),
        valorPago: valorPago
    });

    this.persistir();
    this.fecharModal();
    alert("Pagamento registrado e saldo zerado!");
},

    prepararEdicaoServico(id = null) {
    const s = id ? this.dados.servicos.find(x => x.id === id) : { nome: '', valor: '' };
    const btnExcluir = id ? `<button class="btn-primary" style="background:var(--danger); color:white; margin-top:5px" onclick="app.excluirItem('servicos', ${id})">Excluir Serviço</button>` : '';

    const html = `
        <input type="hidden" id="ser-id" value="${id || ''}">
        <label style="font-size:12px; color:#888">Nome do Serviço:</label>
        <input type="text" id="ser-nome" value="${s.nome}">
        <label style="font-size:12px; color:#888; margin-top:10px; display:block">Preço (R$):</label>
        <input type="number" id="ser-valor" value="${s.valor}">
        
        <button class="btn-primary" style="margin-top:20px" onclick="app.salvarServico()">Salvar</button>
        ${btnExcluir}
        <button class="btn-primary" style="background:#333; margin-top:5px" onclick="app.fecharModal()">Cancelar</button>
    `;
    this.abrirModalForm(id ? "Editar Serviço" : "Novo Serviço", html);
},

salvarServico() {
    const nome = document.getElementById('ser-nome').value;
    const valor = parseFloat(document.getElementById('ser-valor').value);
    const id = document.getElementById('ser-id').value;
    if (nome && !isNaN(valor)) {
        if (id) {
            const idx = this.dados.servicos.findIndex(s => s.id == id);
            this.dados.servicos[idx] = { id: parseInt(id), nome, valor };
        } else {
            this.dados.servicos.push({ id: Date.now(), nome, valor });
        }
        this.persistir(); this.fecharModal(); this.renderView('servicos');
    }
},

   prepararEdicaoEstoque(id = null) {
    // Busca os dados ou define valores padrão (incluindo precoCusto)
    const e = id ? this.dados.estoque.find(x => x.id === id) : { nome: '', qtd: '', precoVenda: '', precoCusto: '' };
    
    // Tratamento para manter compatibilidade com itens antigos que usavam apenas .preco
    const precoVendaAtual = e.precoVenda || e.preco || '';

    const btnExcluir = id ? `<button class="btn-primary" style="background:var(--danger); color:white; margin-top:5px" onclick="app.excluirItem('estoque', ${id})">Excluir Produto</button>` : '';

    const html = `
        <input type="hidden" id="est-id" value="${id || ''}">
        
        <label style="font-size:12px; color:#888">Produto:</label>
        <input type="text" id="est-nome" value="${e.nome}" placeholder="Nome do produto">
        
        <label style="font-size:12px; color:#888; margin-top:10px; display:block">Quantidade em Estoque:</label>
        <input type="number" id="est-qtd" value="${e.qtd}" placeholder="Ex: 10">
        
        <div style="display:flex; gap:10px; margin-top:10px">
            <div style="flex:1">
                <label style="font-size:12px; color:#888">Preço Custo (R$):</label>
                <input type="number" id="est-preco-custo" value="${e.precoCusto || ''}" placeholder="0.00" step="0.01">
            </div>
            <div style="flex:1">
                <label style="font-size:12px; color:#888">Preço Venda (R$):</label>
                <input type="number" id="est-preco-venda" value="${precoVendaAtual}" placeholder="0.00" step="0.01">
            </div>
        </div>
        
        <button class="btn-primary" style="margin-top:20px" onclick="app.salvarEstoque()">Salvar Produto</button>
        ${btnExcluir}
        <button class="btn-primary" style="background:#333; margin-top:5px" onclick="app.fecharModal()">Cancelar</button>
    `;
    this.abrirModalForm(id ? "Editar Item" : "Novo Item", html);
},
    salvarEstoque() {
    const nome = document.getElementById('est-nome').value;
    const qtd = parseInt(document.getElementById('est-qtd').value);
    const precoCusto = parseFloat(document.getElementById('est-preco-custo').value) || 0;
    const precoVenda = parseFloat(document.getElementById('est-preco-venda').value) || 0;
    const id = document.getElementById('est-id').value;

    if (nome && !isNaN(qtd)) {
        const dadosProduto = { 
            id: id ? parseInt(id) : Date.now(), 
            nome, 
            qtd, 
            precoCusto, 
            precoVenda 
        };

        if (id) {
            const idx = this.dados.estoque.findIndex(e => e.id == id);
            this.dados.estoque[idx] = dadosProduto;
        } else {
            this.dados.estoque.push(dadosProduto);
        }

        this.persistir(); 
        this.fecharModal(); 
        this.renderView('estoque');
    } else {
        alert("Por favor, preencha o nome e a quantidade.");
    }
},

    excluirItem(tipo, id) {
    const confirmacao = confirm("Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.");
    if (confirmacao) {
        // Filtra o array removendo o item com o ID correspondente
        this.dados[tipo] = this.dados[tipo].filter(item => item.id !== id);
        
        this.persistir();
        this.fecharModal();
        
        // Atualiza a tela correta após excluir
        if (tipo === 'prestadores') this.renderListaPrestadores();
        else this.renderView(tipo);
        
        alert("Item excluído com sucesso!");
    }
},
compartilharLink() {
    try {
        // Pega as credenciais que você usou para logar
        const creds = JSON.parse(localStorage.getItem('barber_auth')) || githubDB.creds;

        if (!creds || !creds.token || !creds.userEmail) {
            alert("Erro: Você precisa estar logado com Token e E-mail para gerar o link completo!");
            return;
        }

        if (!this.dados.servicos || this.dados.servicos.length === 0) {
            alert("Cadastre pelo menos um serviço antes de compartilhar!");
            return;
        }

        // Criamos o pacote com TUDO: serviços, prestadores, TOKEN e EMAIL
        const dadosParaUrl = {
            s: this.dados.servicos,
            p: this.dados.prestadores,
            t: creds.token,      // Token de acesso
            e: creds.userEmail,  // E-mail do usuário
            f: creds.file        // Nome do arquivo DB
        };
        
        // Codifica para a URL
        const tokenUrl = btoa(unescape(encodeURIComponent(JSON.stringify(dadosParaUrl))));
        const url = window.location.origin + window.location.pathname + `?agendar=true&data=${tokenUrl}`;
        
        navigator.clipboard.writeText(url).then(() => {
            alert("Link Mágico gerado! O cliente entrará direto e os agendamentos cairão no seu sistema.");
        });
    } catch (e) {
        console.error("Erro ao gerar link:", e);
        alert("Não foi possível gerar o link.");
    }
},
}


const githubDB = {
    owner: "jirineu",
    repo: "dados-barbearia",

    // Recupera as credenciais globais (E-mail e Token)
    get creds() {
        const config = localStorage.getItem('barber_auth');
        return config ? JSON.parse(config) : null;
    },

    async carregar() {
        const c = this.creds;
        if (!c) return null;

        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${c.file}?t=${Date.now()}`;
        
        try {
            const res = await fetch(url, {
                headers: { 
                    'Authorization': `token ${c.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (res.status === 404) return null;

            const data = await res.json();
            // Armazena o SHA atual para permitir o próximo salvamento
            localStorage.setItem(`sha_${c.file}`, data.sha);
            return JSON.parse(decodeURIComponent(escape(atob(data.content))));
        } catch (e) { 
            console.error("Erro ao carregar:", e);
            return null; 
        }
    },

    async salvar(dados) {
        const c = this.creds;
        if (!c) return false;

        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${c.file}`;
        const currentSha = localStorage.getItem(`sha_${c.file}`);

        const corpo = {
            message: `Sincronia: ${c.userEmail}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(dados, null, 2))))
        };

        if (currentSha) corpo.sha = currentSha;

        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 
                    'Authorization': `token ${c.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(corpo)
            });

            if (res.ok) {
                const resData = await res.json();
                // Atualiza o SHA após o salvamento bem-sucedido
                localStorage.setItem(`sha_${c.file}`, resData.content.sha);
                return true;
            }
            return false;
        } catch (e) { 
            console.error("Erro ao salvar:", e);
            return false; 
        }
    }
};
// --- 2. FUNÇÕES DE SUPORTE ---
// Garante que as credenciais sejam salvas e o app inicializado
// Garante que as credenciais sejam salvas e o app inicializado
async function configurarCloud() {
    const emailInput = document.getElementById('u-email').value.trim().toLowerCase();
    const tokenInput = document.getElementById('u-token').value.trim();

    if (!emailInput || !tokenInput) return alert("Preencha E-mail e Token.");

    // Gera o nome do arquivo baseado no e-mail (Exatamente como no RoutineAI)
    const fileName = `db_${btoa(emailInput).substring(0, 8)}.json`;

    // Define as credenciais globais
    localStorage.clear(); // Limpa dados de logins anteriores
    localStorage.setItem('barber_auth', JSON.stringify({
        token: tokenInput, 
        file: fileName, 
        userEmail: emailInput
    }));

    try {
        // Tenta carregar para ver se o arquivo já existe no repositório
        const dadosNuvem = await githubDB.carregar();
        
        if (dadosNuvem) {
            app.dados = dadosNuvem;
            alert(`Bem-vindo de volta!`);
        } else {
            // USUÁRIO NOVO: Estrutura inicial da barbearia
            app.dados = { 
                usuario: emailInput, 
                caixa: 0, agenda: [], historico: [], prestadores: [], estoque: [], servicos: [],
                config: { inicioDia: 8, fimDia: 19, intervalo: 30 }
            };

            // CRIAÇÃO FÍSICA no GitHub
            const sucessoAoCriar = await githubDB.salvar(app.dados);
            if (!sucessoAoCriar) throw new Error("Erro ao criar banco de dados no GitHub. Verifique o Token.");
            
            alert(`Novo banco de dados criado para: ${emailInput}`);
        }

        // Salva backup local e recarrega
        localStorage.setItem(`barber_local_db`, JSON.stringify(app.dados));
        window.location.reload(); 

    } catch (e) {
        alert("Falha: " + e.message);
    }
}

// Sincronização automática inicial
async function sincronizarComGithub() {
    // Verifica se as credenciais existem
    if (!githubDB.creds) return false;
    
    try {
        const dadosNuvem = await githubDB.carregar();
        
        if (dadosNuvem) {
            app.dados = dadosNuvem;
            // Salva no cache local para uso offline
            localStorage.setItem(`barber_local_db`, JSON.stringify(app.dados));
            return true;
        }
    } catch (e) {
        console.error("Erro ao sincronizar com a nuvem", e);
    }
    return false;
}

// Função de Logout inspirada no seu exemplo
function logout() {
    if(confirm("Deseja realmente sair?")) {
        localStorage.clear();
        location.reload();
    }
}
// --- 3. INICIALIZAÇÃO ÚNICA DO SISTEMA ---
window.onload = async () => {
    const authScreen = document.getElementById('auth-screen');
    const mainApp = document.getElementById('main-app');
    const params = new URLSearchParams(window.location.search);

    // --- INÍCIO DA PARTE MOVIDA PARA O TOPO ---
    // Movemos a leitura do link para cá para que o sistema saiba quem é o usuário ANTES de pedir login
    if (params.has('agendar') && params.has('data')) {
        try {
            const info = JSON.parse(decodeURIComponent(escape(atob(params.get('data')))));
            if (info.t && info.e) {
                const authData = {
                    token: info.t,
                    userEmail: info.e,
                    file: info.f || 'barber_db.json'
                };
                // Injeta as credenciais para o sistema reconhecer o dono do link
                localStorage.setItem('barber_auth', JSON.stringify(authData));
                githubDB.creds = authData; 
                
                app.dados.servicos = info.s || [];
                app.dados.prestadores = info.p || [];
            }
        } catch (e) {
            console.error("Erro ao processar dados do link", e);
        }
    }
    // --- FIM DA PARTE MOVIDA ---

    // 1. Agora o githubDB.creds já terá os dados se veio pelo link
    const credencial = githubDB.creds;

    // Se não tiver login, mostra a tela de autenticação
    if (!credencial) {
        if (authScreen) authScreen.style.display = 'flex';
        if (mainApp) mainApp.style.display = 'none';
        return;
    }

    // Se está logado, libera o app e esconde o login
    if (authScreen) authScreen.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';

    // 2. Tenta carregar os dados da nuvem
    const dadosNuvem = await githubDB.carregar();
    
    if (dadosNuvem) {
        app.dados = dadosNuvem;
        
        const currentSha = localStorage.getItem(`sha_${credencial.file}`);
        if (!currentSha) {
            console.log("Sincronizando banco inicial na nuvem...");
            await githubDB.salvar(app.dados);
        }
    } else {
        const local = localStorage.getItem('barber_local_db');
        if (local) {
            app.dados = JSON.parse(local);
        }
    }

    // 4. Garante estrutura mínima
    const padrao = { 
        usuario: credencial.userEmail, 
        servicos: [], prestadores: [], agenda: [], estoque: [], caixa: 0, historico: [],
        config: { inicioDia: 8, fimDia: 19, intervalo: 30 }
    };
    app.dados = { ...padrao, ...app.dados };

    localStorage.setItem('barber_local_db', JSON.stringify(app.dados));

    // 5. Renderiza a visão inicial
    app.renderView('dash');

    // Lógica visual para esconder menus se for cliente
    if (params.has('agendar')) {
        const esconder = ['.tab-bar', '.mobile-header', '#view-dash', '.admin-only', '#auth-screen'];
        esconder.forEach(s => { 
            const el = document.querySelector(s); 
            if (el) el.style.display = 'none'; 
        });

        document.body.style.background = "#000";
        document.getElementById('main-app').style.display = 'block';
        
        if (app.prepararNovoAgendamento) app.prepararNovoAgendamento();
    }
};

// Logout limpa tudo para permitir login com outro e-mail
function logout() {
    if(confirm("Deseja realmente sair?")) {
        localStorage.clear();
        location.reload();
    }
}
