export const USER_HISTORY_QUERY = `
  query UserHistory($user: Bytes!, $limit: Int = 50) {
    deposits(where: { user: $user }, first: $limit, orderBy: timestamp, orderDirection: desc) {
      id
      user
      collection
      tokenId
      timestamp
      txHash
    }
    loans(where: { borrower: $user }, first: $limit, orderBy: createdAt, orderDirection: desc) {
      id
      borrower
      tokenId
      amount
      ltv
      status
      createdAt
      repaidAt
    }
    licenses(where: { holder: $user }, first: $limit, orderBy: expiresAt, orderDirection: desc) {
      id
      holder
      nftCollection
      nftTokenId
      licenseType
      expiresAt
    }
  }
`;

export const GLOBAL_STATS_QUERY = `
  query GlobalStats($limit: Int = 200) {
    loans(first: $limit, orderBy: createdAt, orderDirection: desc) {
      id
      status
      amount
      ltv
      tokenId
      createdAt
    }
    liquidations(first: $limit, orderBy: timestamp, orderDirection: desc) {
      id
      loan {
        id
        status
      }
      tokenId
      liquidationPrice
      timestamp
    }
    revenueDistributions(first: $limit, orderBy: timestamp, orderDirection: desc) {
      id
      tokenId
      amount
      distributionType
      timestamp
    }
  }
`;

export const PANIC_EVENTS_QUERY = `
  query PanicEvents($limit: Int = 100) {
    panicEvents(first: $limit, orderBy: enteredAt, orderDirection: desc) {
      id
      tokenId
      enteredAt
      exitedAt
      duration
    }
    loans(where: { status: PANIC }, first: $limit, orderBy: createdAt, orderDirection: desc) {
      id
      tokenId
      borrower
      amount
      ltv
      status
      createdAt
    }
  }
`;
