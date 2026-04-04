from eth_account import Account
priv = "21ef7727cbed74022a5f88482734b5edd024652528e9797b9c23f30761447449"
print(Account.from_key(priv).address)
