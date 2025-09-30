#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Функция для выполнения Git команд
function runGitCommand(command) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8',
      cwd: process.cwd()
    });
    return result.trim();
  } catch (error) {
    console.error(`Git command failed: ${command}`);
    console.error(error.message);
    return null;
  }
}

// Функция для автоматического коммита
function autoCommit() {
  console.log('🔄 Starting auto-commit process...');
  
  // Проверяем статус Git
  const status = runGitCommand('git status --porcelain');
  if (!status) {
    console.log('❌ Git not available or not a git repository');
    return;
  }
  
  if (!status.trim()) {
    console.log('✅ No changes to commit');
    return;
  }
  
  console.log('📝 Changes detected:');
  console.log(status);
  
  // Добавляем все изменения
  runGitCommand('git add .');
  
  // Создаем коммит
  const timestamp = new Date().toISOString();
  const commitMessage = `Auto-commit: ${timestamp}`;
  
  const commitResult = runGitCommand(`git commit -m "${commitMessage}"`);
  if (commitResult) {
    console.log('✅ Commit created successfully');
    
    // Пушим изменения
    const pushResult = runGitCommand('git push');
    if (pushResult) {
      console.log('🚀 Changes pushed to remote');
    } else {
      console.log('❌ Failed to push changes');
    }
  } else {
    console.log('❌ Failed to create commit');
  }
}

// Запускаем автоматический коммит
if (require.main === module) {
  autoCommit();
}

module.exports = { autoCommit };

