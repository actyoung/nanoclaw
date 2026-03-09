# NanoClaw Agent Container - 开发增强版
FROM node:22-slim

# ============================================
# 1. 系统依赖（最稳定，很少变化）
# ============================================
RUN apt-get update && apt-get install -y \
    # Chromium 浏览器依赖
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    # 基础工具
    curl \
    git \
    wget \
    ca-certificates \
    gnupg \
    # 常用开发工具
    vim \
    nano \
    htop \
    tree \
    unzip \
    zsh \
    # Python3
    python3 \
    python3-pip \
    # 构建工具
    build-essential \
    gcc \
    g++ \
    make \
    # 其他实用工具
    jq \
    httpie \
    # 文档处理
    pandoc \
    # Git 工具
    tig \
    # 压缩工具
    p7zip-full \
    # CSV 处理
    csvkit \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# 2. 编程语言环境（稳定，偶尔升级版本）
# ============================================

# Go
ENV GOLANG_VERSION=1.22.0
ENV PATH=$PATH:/usr/local/go/bin
ENV GOPATH=/home/node/go
ENV GOBIN=$GOPATH/bin
ENV PATH=$PATH:$GOBIN

RUN curl -L https://go.dev/dl/go${GOLANG_VERSION}.linux-amd64.tar.gz -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz

# Rust
ENV RUSTUP_HOME=/home/node/.rustup
ENV CARGO_HOME=/home/node/.cargo
ENV PATH=$PATH:$CARGO_HOME/bin

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --no-modify-path

# ============================================
# 3. 全局 npm 包（相对稳定）
# ============================================
RUN npm install -g agent-browser @anthropic-ai/claude-code skills pnpm prettier

# ============================================
# 4. 现代 CLI 工具（版本更新较频繁，但不如代码频繁）
# ============================================

# ripgrep
RUN curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.0/ripgrep_14.1.0-1_amd64.deb && \
    dpkg -i ripgrep_14.1.0-1_amd64.deb && \
    rm ripgrep_14.1.0-1_amd64.deb

# fd
RUN curl -LO https://github.com/sharkdp/fd/releases/download/v9.0.0/fd_9.0.0_amd64.deb && \
    dpkg -i fd_9.0.0_amd64.deb && \
    rm fd_9.0.0_amd64.deb

# bat
RUN curl -LO https://github.com/sharkdp/bat/releases/download/v0.24.0/bat_0.24.0_amd64.deb && \
    dpkg -i bat_0.24.0_amd64.deb && \
    rm bat_0.24.0_amd64.deb

# lsd
RUN curl -LO https://github.com/lsd-rs/lsd/releases/download/v1.0.0/lsd_1.0.0_amd64.deb && \
    dpkg -i lsd_1.0.0_amd64.deb && \
    rm lsd_1.0.0_amd64.deb

# Starship
RUN curl -sS https://starship.rs/install.sh | sh -s -- -y || \
    (echo "Starship install failed, retrying..." && \
    curl -sS https://starship.rs/install.sh | sh -s -- -y)

# fzf
RUN git clone --depth 1 https://github.com/junegunn/fzf.git /home/node/.fzf && \
    /home/node/.fzf/install --all --no-bash --no-fish && \
    echo '# fzf setup' > /home/node/.fzf.zsh && \
    echo 'export PATH="$HOME/.fzf/bin:$PATH"' >> /home/node/.fzf.zsh && \
    echo 'source "$HOME/.fzf/shell/completion.zsh" 2>/dev/null' >> /home/node/.fzf.zsh && \
    echo 'source "$HOME/.fzf/shell/key-bindings.zsh" 2>/dev/null' >> /home/node/.fzf.zsh && \
    ln -sf /home/node/.fzf/bin/fzf /usr/local/bin/fzf

# git-delta (语法高亮 diff)
RUN curl -LO https://github.com/dandavison/delta/releases/download/0.17.0/git-delta_0.17.0_amd64.deb && \
    dpkg -i git-delta_0.17.0_amd64.deb && \
    rm git-delta_0.17.0_amd64.deb

# yq (YAML 处理器)
RUN curl -LO https://github.com/mikefarah/yq/releases/download/v4.44.1/yq_linux_amd64 && \
    chmod +x yq_linux_amd64 && \
    mv yq_linux_amd64 /usr/local/bin/yq

# shfmt (Shell 脚本格式化)
RUN curl -LO https://github.com/mvdan/sh/releases/download/v3.8.0/shfmt_v3.8.0_linux_amd64 && \
    chmod +x shfmt_v3.8.0_linux_amd64 && \
    mv shfmt_v3.8.0_linux_amd64 /usr/local/bin/shfmt

# hyperfine (命令行基准测试)
RUN curl -LO https://github.com/sharkdp/hyperfine/releases/download/v1.18.0/hyperfine_1.18.0_amd64.deb && \
    dpkg -i hyperfine_1.18.0_amd64.deb && \
    rm hyperfine_1.18.0_amd64.deb

# ============================================
# 5. Shell 配置（相对稳定）
# ============================================

# Oh-My-Zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended && \
    mkdir -p /home/node/.oh-my-zsh && \
    cp -r /root/.oh-my-zsh/* /home/node/.oh-my-zsh/ 2>/dev/null || true

# zshrc 配置
RUN echo '\
    eval "$(starship init zsh)"\n\
    \n\
    alias ll="lsd -la"\n\
    alias ls="lsd"\n\
    alias cat="bat --paging=never"\n\
    alias diff="delta"\n\
    \n\
    export PATH=$PATH:/usr/local/go/bin:/home/node/go/bin\n\
    export PATH=$PATH:/home/node/.cargo/bin\n\
    \n\
    [ -f /home/node/.fzf.zsh ] && source /home/node/.fzf.zsh\n\
    ' >> /home/node/.zshrc

# 设置默认 shell
RUN chsh -s /bin/zsh node

# Make /home/node writable by any UID (container runs as host UID, not node)
RUN chmod 777 /home/node

# ============================================
# 6. 环境变量和工作目录（稳定）
# ============================================
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# ============================================
# 7. 权限设置（中等频率 - 当新增工具目录时需要）
# ============================================
RUN chmod -R 755 /usr/local/go 2>/dev/null || true && \
    chown -R node:node /workspace /home/node

# ============================================
# 8. 应用代码（最频繁变动）
# ============================================
WORKDIR /app

# 先复制 package.json，单独缓存 npm install 层
COPY agent-runner/package*.json ./
RUN npm install

# 再复制代码（这部分变化最频繁）
COPY agent-runner/ ./
RUN npm run build

# Entrypoint（也经常变动）
# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER node
WORKDIR /workspace/group

ENTRYPOINT ["/app/entrypoint.sh"]
