const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');

class eBayListingTracker {
  constructor() {
    this.apiKey = process.env.EBAY_API_KEY;
    this.sellerUsername = process.env.SELLER_USERNAME;
    this.processedListingIds = this.getProcessedListingIds();
    this.octokit = new Octokit({ auth: process.env.GH_TOKEN });
    this.owner = process.env.GITHUB_REPOSITORY.split('/')[0];
    this.repo = process.env.GITHUB_REPOSITORY.split('/')[1];
  }

  getProcessedListingIds() {
    const processedIds = process.env.PROCESSED_LISTING_IDS || '';
    return processedIds.split(',').filter(id => id.trim() !== '');
  }

  async getEbayListings() {
    try {
      const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        params: {
          q: `seller:${this.sellerUsername}`,
          limit: 50,
          sort: 'creationTime DESC'
        }
      });

      return response.data.itemSummaries || [];
    } catch (error) {
      console.error('Error fetching eBay listings:', error.message);
      return [];
    }
  }

  async updateProcessedListingIds(newListingIds) {
    const updatedIds = Array.from(new Set([
      ...this.processedListingIds, 
      ...newListingIds
    ])).slice(-500).join(',');

    try {
      await this.octokit.actions.updateRepoSecret({
        owner: this.owner,
        repo: this.repo,
        secret_name: 'PROCESSED_LISTING_IDS',
        encrypted_value: Buffer.from(updatedIds).toString('base64')
      });
      console.log('Successfully updated processed listing IDs');
    } catch (error) {
      console.error('Error updating processed listing IDs:', error.message);
    }
  }

  async findAndNotifyNewListings() {
    if (!this.apiKey || !this.sellerUsername) {
      console.error('Missing required environment variables');
      return { newListings: [], listingDetails: '' };
    }

    const currentListings = await this.getEbayListings();

    const newListings = currentListings.filter(
      listing => !this.processedListingIds.includes(listing.itemId)
    );

    // Prepare listing details for output
    const listingDetails = newListings.map(listing => 
      `Title: ${listing.title}\nURL: ${listing.itemWebUrl}`
    ).join('\n\n');

    // Update processed listing IDs if new listings found
    if (newListings.length > 0) {
      await this.updateProcessedListingIds(
        newListings.map(listing => listing.itemId)
      );
    }

    console.log(`Processed ${newListings.length} new listings`);
    
    return { 
      newListings, 
      listingDetails: listingDetails || 'No new listings found' 
    };
  }
}

// Run the tracker
const tracker = new eBayListingTracker();
tracker.findAndNotifyNewListings()
  .then(result => {
    // Write result to a file for GitHub Actions to read
    fs.writeFileSync('listing_results.json', JSON.stringify(result));
    process.exit(result.newListings.length > 0 ? 0 : 78);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });